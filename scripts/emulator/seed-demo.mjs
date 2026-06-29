#!/usr/bin/env node
/**
 * Demo data seeder — fills the Overview dashboard with a realistic, multi-day
 * dataset by driving the REAL event APIs, then backdating into the closed-period
 * window. Exercises exactly what the WP plugin exercises (search → click → cart →
 * checkout → order WITH value/quantity → abandon/remove), tagged so it's safely
 * removable.
 *
 *   node scripts/emulator/seed-demo.mjs [--instance 10] [--origin https://grolabs.io] [--url http://localhost:3030] [--days 14] [--yes-prod]
 *
 * After it pushes, run the backdate+refresh step (the script prints the SQL), or
 * `npm run emulate:demo` which chains push → you run the printed SQL via Studio/MCP.
 *
 * Rows are tagged `user_id LIKE 'demo-%'` (the day offset is encoded:
 * demo-<dayOffset>-b<shopper>) so backdating and cleanup key off it.
 */
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const INSTANCE = Number(flag("--instance", "10"));
const ORIGIN = flag("--origin", "https://grolabs.io");
const BASE = (flag("--url", "http://localhost:3030")).replace(/\/+$/, "");
const DAYS = Number(flag("--days", "14"));
const yesProd = argv.includes("--yes-prod");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && !yesProd) {
  console.error(`✗ Refusing non-localhost URL without --yes-prod: ${BASE}`); process.exit(1);
}

const HEADERS = { "Content-Type": "application/json", Origin: ORIGIN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rng = mulberry32(20260627);
const rand = () => rng();
const pick = (a) => a[Math.floor(rand() * a.length)];

// Pet-store terms (Wazú catalog) → most hit the real index; a few deliberate misses.
const HIT = ["dog food", "cat food", "dog", "cat", "treats", "toy", "collar", "leash", "shampoo", "bed", "litter", "brush", "vitamins", "puppy"];
const MISS = ["aquarium", "ferret cage", "saddle", "parrot perch", "reptile lamp", "hamster wheel"];

async function postJson(path, body) {
  try {
    const res = await fetch(BASE + path, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch { /* */ }
    return { status: res.status, json };
  } catch (e) { return { status: `ERR ${e?.message || e}`, json: null }; }
}

async function main() {
  console.log(`▶ demo seed → ${BASE}  instance ${INSTANCE} · origin ${ORIGIN} · ${DAYS} days`);
  const c = { searches: 0, hitSearches: 0, clicks: 0, adds: 0, checkouts: 0, orders: 0, removes: 0, errs: 0 };

  for (let d = 1; d <= DAYS; d++) {
    const shoppers = 8 + Math.round((DAYS - d) * 0.5 + rand() * 4); // recent days busier (an upward trend)
    for (let s = 0; s < shoppers; s++) {
      const uid = `demo-${d}-b${s}`;
      const acct = rand() < 0.35 ? `demo-acct-${d}-${s}` : null;
      let hitDoc = null, hitQuid = null;
      const nSearch = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < nSearch; k++) {
        const q = rand() < 0.12 ? pick(MISS) : pick(HIT);
        const { status, json } = await postJson("/api/v1/search", {
          instance_id: INSTANCE, query: q, limit: 20, offset: 0, userId: uid, accountId: acct, committed: true,
        });
        c.searches++;
        if (typeof status !== "number") c.errs++;
        const hits = Array.isArray(json?.hits) ? json.hits : [];
        const quid = json?.metadata?.queryUid || "";
        if (hits.length > 0 && quid) { c.hitSearches++; hitDoc = hits[0]?.document || null; hitQuid = quid; }
        await sleep(10);
      }

      // Funnel is EVENT-driven and un-gated — it does NOT require a search hit
      // (carts come from anywhere). Search attribution (queryUid) is attached
      // only when a real hit happened, so search→purchase reflects reality while
      // sales/cart/order KPIs populate regardless of the index.
      const objId = hitDoc ? String(hitDoc.woocommerce_id ?? hitDoc.id ?? "") : `demo-p${1 + Math.floor(rand() * 40)}`;
      const name = hitDoc?.name || `Product ${objId}`;
      const cart = `demo-${d}-c${s}`;
      const attr = hitQuid ? { queryUid: hitQuid, position: 0 } : {};
      const base = { instance_id: INSTANCE, userId: uid, accountId: acct, objectId: objId, objectName: name, cartId: cart };

      // A search-result click only happens when a search actually returned a hit.
      if (hitDoc && hitQuid && rand() < 0.55) {
        await postJson("/api/v1/events", { ...base, ...attr, eventType: "click", eventName: "Search Result Clicked" });
        c.clicks++;
      }
      // ~38% of shoppers put something in a cart (direct nav, PLP, or post-click).
      if (rand() < 0.38) {
        const placement = pick(["pdp", "pdp", "plp", "plp", "search_results", "related", "frequently_bought_together", "recently_viewed"]);
        await postJson("/api/v1/events", { ...base, ...attr, eventType: "conversion", eventName: "Added to cart", placement });
        c.adds++;
        if (rand() < 0.6) {
          await postJson("/api/v1/events", { ...base, ...attr, eventType: "conversion", eventName: "Proceeded to check out" });
          c.checkouts++;
          if (rand() < 0.78) {
            await postJson("/api/v1/events", { ...base, ...attr, eventType: "conversion", eventName: "Completed order", orderId: `demo-${d}-o${s}`, value: 20 + Math.round(rand() * 100), quantity: 1 + Math.floor(rand() * 3) });
            c.orders++;
          } else {
            await postJson("/api/v1/events", { ...base, eventType: "cart_remove", eventName: "Removed from cart" });
            c.removes++;
          }
        } else if (rand() < 0.45) {
          await postJson("/api/v1/events", { ...base, eventType: "cart_remove", eventName: "Removed from cart" });
          c.removes++;
        }
      }
      await sleep(6);
    }
    process.stdout.write(`  day -${d}: ${shoppers} shoppers\r`);
  }
  console.log(`\n  pushed: ${JSON.stringify(c)}`);
  console.log(`\n  NEXT — backdate into the closed window + refresh (run in Studio SQL or via MCP):`);
  console.log(`    update public.analytics_event set created_at = (current_date - split_part(user_id,'-',2)::int)::timestamptz + interval '11 hours' + (random()*interval '6 hours')`);
  console.log(`      where instance_id=${INSTANCE} and user_id like 'demo-%';`);
  console.log(`    update public.query_log set created_at = (current_date - split_part(user_id,'-',2)::int)::timestamptz + interval '11 hours' + (random()*interval '6 hours')`);
  console.log(`      where instance_id=${INSTANCE} and user_id like 'demo-%';`);
  console.log(`\n  IDENTITY + RECENCY (so the Users section shows new/returning/anonymous/registered):`);
  console.log(`    -- ~35% of demo users become registered (deterministic per user_id)`);
  console.log(`    update public.analytics_event set account_id = 'demo-acct-'||substr(md5(user_id),1,12)`);
  console.log(`      where instance_id=${INSTANCE} and user_id like 'demo-%' and account_id is null`);
  console.log(`        and get_byte(decode(md5(user_id),'hex'),0) < 90;`);
  console.log(`    -- ~40% of recently-active demo users get an OLD anchor row → "returning"`);
  console.log(`    insert into public.analytics_event (instance_id,event_type,event_name,user_id,account_id,created_at,origin)`);
  console.log(`    select ${INSTANCE},'session','historical_anchor',user_id,max(account_id),`);
  console.log(`      (current_date-(31+(get_byte(decode(md5(user_id),'hex'),2)%50)))::timestamptz + interval '12 hours','${ORIGIN}'`);
  console.log(`    from public.analytics_event where instance_id=${INSTANCE} and user_id like 'demo-%'`);
  console.log(`      and event_name<>'historical_anchor' and created_at >= (current_date-30)::timestamptz`);
  console.log(`      and get_byte(decode(md5(user_id),'hex'),1) < 104 group by user_id;`);
  console.log(`    select public.refresh_metric_daily(null);`);
  console.log(`\n  REALTIME CARTS (Carts tab — fresh "Today" open carts; not part of metric_daily):`);
  console.log(`    insert into public.analytics_event (instance_id,event_type,event_name,placement,user_id,cart_id,object_id,object_name,created_at,origin)`);
  console.log(`    select ${INSTANCE},'conversion','Added to cart', case when n%3=0 then 'pdp' when n%3=1 then 'plp' else 'related' end,`);
  console.log(`      'demo-live-b'||n,'demo-live-c'||n,'demo-p'||(1+(n%40)),'Product '||(1+(n%40)),`);
  console.log(`      now() - (interval '1 hour' * ((n*1.7)::int % 20)),'${ORIGIN}'`);
  console.log(`    from generate_series(1,14) n;`);
  console.log(`\n  CLEANUP later:`);
  console.log(`    delete from public.analytics_event where instance_id=${INSTANCE} and user_id like 'demo-%';`);
  console.log(`    delete from public.query_log where instance_id=${INSTANCE} and user_id like 'demo-%';`);
  console.log(`    select public.refresh_metric_daily(null);`);
}
main();
