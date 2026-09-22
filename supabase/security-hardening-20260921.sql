-- ClickOnMe security hardening applied to production on 2026-09-21.
-- Keep this file with the source backup so database privileges can be restored consistently.

-- The legacy suspension RPC performs its own admin check, but anonymous callers
-- do not need EXECUTE permission at all.
revoke execute on function public.admin_suspend_profile(bigint) from anon;

-- Public profile visitors only need fields rendered by the public card, kit,
-- and dynamic manifest. Internal ownership and sales metadata stay private.
revoke select on table public.profiles from anon;

grant select (
  slug,
  name,
  role,
  description,
  photo_url,
  whatsapp,
  phone,
  facebook,
  instagram,
  youtube,
  website,
  data,
  status,
  trial_ends_at,
  current_period_end,
  subscription_plan,
  account_role,
  demo_profile
) on table public.profiles to anon;
