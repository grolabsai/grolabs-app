## Connect Google Analytics

This step is the same whatever your store runs on, so it applies to both tracks.

Connecting GA4 fills the **Traffic** dashboard — sessions, users, engagement,
channels, landing and exit pages, geography, device mix — and powers the live
active-users widget.

### Before you start

You need a **Google account with at least Viewer access to the GA4 property**
you want to track. It does not have to be the property's owner, and it does not
have to be the account you use to sign in to GroLabs.

The connection belongs to the **instance**, not to you personally. Once it is
made, everyone on the instance sees the data — nobody else has to repeat these
steps.

### Steps

1. Go to **Configuration → Google Analytics**.
2. Click **Connect Google Analytics**. You will be sent to Google.
3. Sign in with the Google account that can view the property, and approve the
   access request. GroLabs asks for **read-only** analytics access — we can
   never change anything in your Google Analytics.
4. You come back to GroLabs with the account connected. Now choose **which
   property** to track from the dropdown, which lists every property that
   account can reach, shown as *account — property (#id)*.
5. Click **Save**. GroLabs immediately backfills the last 7 days, so the Traffic
   dashboard has data straight away rather than waiting for the nightly update.

After that it updates on its own. The dashboard shows finalised days through
yesterday — Google takes 24–48 hours to settle a day's numbers, so today is
deliberately excluded rather than shown as a misleading drop.

### If the dropdown is empty

You can type the property ID by hand instead. Find it in Google Analytics under
**Admin → Property settings**; it is a **9-digit number**, not the Measurement
ID that starts with `G-`.

If a message appears under the field explaining why the list could not load,
send it to us — it names the exact cause.

### If GroLabs asks you to reconnect

Google access can lapse: someone revokes it in their Google security settings,
the connected account loses access to the property, or it simply goes unused for
several months. When that happens the Google Analytics screen shows **Google
access expired** and the Traffic dashboard says its figures are frozen at the
last successful update rather than pretending they are current.

Click **Reconnect** and sign in again. **Any** Google account with view access
to the property can restore it — it does not have to be the one that connected
originally. Your property choice and all existing history are kept.

### Changing to a different property

Switching the property **discards the traffic history already stored for this
instance**, because that history belongs to the previous property and mixing two
sites into one dashboard would make both meaningless. GroLabs asks you to
confirm, then starts a fresh backfill. Reconnecting the *same* property never
deletes anything.
