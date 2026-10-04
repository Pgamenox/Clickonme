alter table public.profiles
  add column if not exists nfc_status text not null default 'sin_tarjeta',
  add column if not exists nfc_card_id text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_nfc_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_nfc_status_check
      check (nfc_status = any (array['sin_tarjeta'::text,'solicitada'::text,'programada'::text,'entregada'::text]));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_nfc_card_id_length_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_nfc_card_id_length_check
      check (nfc_card_id is null or char_length(nfc_card_id) <= 120);
  end if;
end $$;
