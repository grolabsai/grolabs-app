"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  HelpCircle,
  KeyRound,
  Trash2,
} from "lucide-react";
import { provisionSearchKey, revokeSearchKey } from "./actions";
import type { SearchKeyStatus } from "@/lib/search/search-key";

/**
 * The storefront key panel, per docs/design/direct-meilisearch-search.md
 * Phase 1 step 4 (R-9: manual enforcement has to be visible to be real).
 *
 * The panel's whole job is to make five states unmistakable from each other,
 * because conflating them is how an operator is misled about whether a
 * merchant can search (UX.md: "two states that mean different things must not
 * look alike" — stale, empty and not-connected rendering identically). They
 * differ by label, by colour AND by border shape, so the distinction survives
 * a dimmed screen or a reader who does not separate red from green:
 *
 *   live        — we hold a key and Meilisearch confirms it exists
 *   missing     — never issued
 *   revoked     — we revoked it; history says when
 *   gone        — we hold a key Meilisearch no longer has (deleted by hand);
 *                 search is ALREADY failing and the record is stale
 *   unverified  — we hold a key but could not reach Meilisearch to check
 *
 * "LIVE" is a claim the build can go and verify, so it does (UX.md: a state
 * label is checked against the thing it labels). `liveUpstream` carries that
 * check; `null` means unchecked and must never render as live.
 */

type View = "live" | "missing" | "revoked" | "gone" | "unverified";

type PillStyle = { className: string; style?: React.CSSProperties };

const PILLS: Record<View, PillStyle> = {
  live: {
    className: "s-tag s-tag-success",
    style: { border: "0.5px solid var(--gl-success)" },
  },
  missing: { className: "s-tag s-tag-neutral" },
  revoked: {
    className: "s-tag s-tag-neutral",
    style: { borderStyle: "dotted", borderWidth: 1 },
  },
  gone: {
    className: "s-tag s-tag-danger",
    style: { border: "1px solid var(--gl-danger)" },
  },
  unverified: {
    className: "s-tag s-tag-neutral",
    style: { borderStyle: "dashed", borderWidth: 1 },
  },
};

const ICONS: Record<View, typeof KeyRound> = {
  live: CheckCircle2,
  missing: KeyRound,
  revoked: KeyRound,
  gone: AlertTriangle,
  unverified: HelpCircle,
};

export function StorefrontKeyPanel({
  instanceId,
  status,
}: {
  instanceId: number;
  status: SearchKeyStatus;
}) {
  const t = useTranslations("configuration.search.storefrontKey");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"provision" | "revoke" | null>(null);

  const { record, liveUpstream, history } = status;

  const view: View =
    record === null
      ? history.length > 0
        ? "revoked"
        : "missing"
      : liveUpstream === false
        ? "gone"
        : liveUpstream === null
          ? "unverified"
          : "live";

  // Fixed timezone so the server-rendered markup and the client's hydration
  // agree — a locale-default format differs between the two and React would
  // report a mismatch.
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "—");

  const pill = PILLS[view];
  const body =
    view === "revoked"
      ? t("state.revokedBody", { date: when(history[0]?.revokedAt ?? null) })
      : t(
          view === "live"
            ? "state.liveBody"
            : view === "missing"
              ? "state.missingBody"
              : view === "gone"
                ? "state.goneBody"
                : "state.unverifiedBody"
        );

  function handleProvision() {
    setBusy("provision");
    startTransition(async () => {
      const result = await provisionSearchKey(instanceId);
      setBusy(null);
      if (result.ok) {
        toast.success(t("toast.provisioned"));
      } else {
        toast.error(t("toast.failed", { message: result.message ?? result.error }));
      }
    });
  }

  function handleRevoke() {
    setBusy("revoke");
    setConfirming(false);
    startTransition(async () => {
      const result = await revokeSearchKey(instanceId);
      setBusy(null);
      if (result.ok) {
        if (result.revoked) toast.success(t("toast.revoked"));
        else toast.info(t("toast.alreadyRevoked"));
      } else {
        toast.error(t("toast.failed", { message: result.message ?? result.error }));
      }
    });
  }

  async function handleCopy() {
    if (!record) return;
    await navigator.clipboard.writeText(record.keyValue);
    toast.success(t("actions.copied"));
  }

  const showKey = record !== null && (view === "live" || view === "unverified");

  return (
    <div className="flex flex-col gap-4">
      {/* State — label, colour and border shape all carry it. */}
      <div className="flex items-start gap-3">
        <span className={pill.className} style={pill.style}>
          <Icon icon={ICONS[view]} size={12} />
          {t(
            view === "live"
              ? "state.liveLabel"
              : view === "missing"
                ? "state.missingLabel"
                : view === "revoked"
                  ? "state.revokedLabel"
                  : view === "gone"
                    ? "state.goneLabel"
                    : "state.unverifiedLabel"
          )}
        </span>
        <p className="text-sm text-muted-foreground flex-1">{body}</p>
      </div>

      {/* The credential itself. A code identifier is never broken mid-word, so
          it sits in its own horizontally scrolling container. Rendered as code
          rather than a read-only input: it cannot be typed into, so it must not
          look like a field. */}
      {showKey && record && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflowX: "auto",
                padding: "8px 10px",
                border: "0.5px solid var(--gl-border)",
                borderRadius: "var(--gl-radius-sm)",
                background: "var(--gl-surface)",
              }}
            >
              <code
                style={{
                  fontFamily: "var(--gl-font-mono)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  color: "var(--gl-text)",
                }}
              >
                {record.keyValue}
              </code>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              <Icon icon={Copy} />
              {t("actions.copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>
        </div>
      )}

      {/* Actions. Revoking is destructive, so it carries the danger colour at
          rest rather than on hover, and confirms inside this card. */}
      <div className="flex flex-wrap items-center gap-2">
        {(view === "missing" || view === "revoked") && (
          <Button type="button" size="sm" onClick={handleProvision} disabled={pending}>
            <Icon icon={KeyRound} />
            {busy === "provision" ? t("actions.provisioning") : t("actions.provision")}
          </Button>
        )}

        {view === "gone" && (
          <>
            <Button type="button" size="sm" onClick={handleProvision} disabled={pending}>
              <Icon icon={KeyRound} />
              {busy === "provision" ? t("actions.provisioning") : t("actions.reissue")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRevoke}
              disabled={pending}
            >
              {busy === "revoke" ? t("actions.revoking") : t("actions.markRevoked")}
            </Button>
          </>
        )}

        {(view === "live" || view === "unverified") &&
          (confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">{t("confirm.body")}</p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleRevoke}
                  disabled={pending}
                >
                  <Icon icon={Trash2} />
                  {busy === "revoke" ? t("actions.revoking") : t("actions.revoke")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  {t("confirm.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              <Icon icon={Trash2} />
              {t("actions.revoke")}
            </Button>
          ))}
      </div>

      {/* Metadata last and packed — looked at rarely, so it does not get a row
          each at the top of the card. */}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto minmax(0, 1fr)",
          columnGap: 16,
          rowGap: 6,
          alignItems: "baseline",
          borderTop: "0.5px solid var(--gl-border)",
          paddingTop: 12,
          fontSize: 12,
        }}
      >
        <Field label={t("fields.keyName")} value={record?.keyName ?? status.expectedKeyName} mono />
        <Field label={t("fields.indexUid")} value={status.indexUid} mono />
        <Field label={t("fields.host")} value={status.host || "—"} mono />
        <Field label={t("fields.created")} value={when(record?.createdAt ?? null)} />
        {record && <Field label={t("fields.uid")} value={record.keyUid} mono />}
      </dl>

      {history.length > 0 && (
        <div className="flex flex-col gap-1" style={{ fontSize: 12 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--gl-text-tertiary)",
            }}
          >
            {t("history.title")}
          </span>
          {history.map((h) => (
            <span key={h.searchKeyId} className="text-muted-foreground">
              {t("history.row", {
                name: h.keyName,
                created: when(h.createdAt),
                revoked: when(h.revokedAt),
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Label column, then content — the same shape for every entry. */
function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt style={{ color: "var(--gl-text-tertiary)", whiteSpace: "nowrap" }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          overflowX: "auto",
          whiteSpace: "nowrap",
          fontFamily: mono ? "var(--gl-font-mono)" : undefined,
          color: "var(--gl-text-secondary)",
        }}
      >
        {value}
      </dd>
    </>
  );
}
