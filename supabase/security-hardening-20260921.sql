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

-- Renewal reminder cron hardening.
-- IMPORTANT: the secret value is intentionally NOT stored in source control.
-- Production stores it encrypted in Supabase Vault with the exact name:
--   clickonme_reminder_cron_secret
-- A database restore must restore/provision that Vault secret before enabling
-- the reminder job. The cron command should only read the decrypted value at
-- execution time and must never embed the secret as a literal.
select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'clickonme-renewal-reminders'
  ),
  command := $cmd$
select
  net.http_post(
    url := 'https://jjiiuvfshzdgjalmsaay.supabase.co/functions/v1/send-renewal-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret',
      (select decrypted_secret
         from vault.decrypted_secrets
        where name = 'clickonme_reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
$cmd$
);
