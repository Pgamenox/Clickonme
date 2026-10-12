-- Additive only: external Mercado Pago checkout links configured by the owner.
-- Sharing a link does NOT register a receipt, release a plan, or create a commission.
alter table public.business_settings
  add column if not exists external_payment_links jsonb not null default '{}'::jsonb;
alter table public.business_settings
  add constraint business_settings_external_payment_links_object
  check (jsonb_typeof(external_payment_links) = 'object');
