/**
 * Authentication category scorers (category_code = "authentication",
 * stage = authentication). Login gating, mobile overlay, and SSO presence.
 *
 * TODO(Prompt 5): replace each `notImplemented` stub with a real scorer.
 * Primary evidence: BROWSER (gating + mobile overlay) + ASE_SITE (SSO buttons).
 */

import { notImplemented, register } from "../registry";

register("auth.gating.browse", notImplemented);
register("auth.mobile.login_overlay", notImplemented);
register("auth.sso.google", notImplemented);
register("auth.sso.apple", notImplemented);
register("auth.sso.meta", notImplemented);
register("auth.sso.microsoft", notImplemented);
