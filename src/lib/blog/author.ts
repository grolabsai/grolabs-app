import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AuthorInfo } from "./seo";

/**
 * Lookup display info for a post's author. Pulls from `auth.users`:
 *   - `raw_user_meta_data.name` if present (set by some OAuth providers)
 *   - `raw_user_meta_data.full_name` as a fallback
 *   - the email's local part as a last resort
 *
 * Used to populate the `author` field of the Article JSON-LD on the
 * public reading page. Service-role because auth.users is locked from
 * RLS and the public page may be anon.
 */
export async function getAuthorInfo(
  authorId: string | null | undefined,
): Promise<AuthorInfo | null> {
  if (!authorId) return null;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.auth.admin.getUserById(authorId);
  if (error || !data?.user) return null;
  const meta =
    (data.user.user_metadata as Record<string, unknown> | undefined) ?? {};
  const name =
    (meta.name as string | undefined) ??
    (meta.full_name as string | undefined) ??
    (data.user.email ? data.user.email.split("@")[0] : null);
  if (!name) return null;
  return {
    name,
    email: data.user.email ?? null,
  };
}
