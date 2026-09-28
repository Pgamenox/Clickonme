-- Reserved QA-E2E fixtures; production metrics always exclude these records.
alter table public.profiles add column is_qa boolean not null default false;
alter table public.sales_representatives add column is_qa boolean not null default false;
alter table public.assisted_sales add column is_qa boolean not null default false;
alter table public.business_events add column is_qa boolean not null default false;
create function private.qa_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.is_qa is distinct from old.is_qa then raise exception 'QA classification is immutable';end if;
  return new;
 end if;
 if tg_table_name='profiles' then
  new.is_qa:=new.slug like 'qa-e2e-%';
 else
  new.is_qa:=new.code like 'QA-E2E-%';
 end if;
 if new.is_qa and not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception 'QA creation requires admin' using errcode='42501';end if;
 return new;
end $$;
create trigger qa_identity_guard before insert or update on public.profiles for each row execute function private.qa_identity_guard();
create trigger qa_identity_guard before insert or update on public.sales_representatives for each row execute function private.qa_identity_guard();
create function private.qa_sale_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare profile_qa boolean; seller_qa boolean;
begin
 select is_qa into profile_qa from public.profiles where id=new.profile_id;
 new.is_qa:=coalesce(profile_qa,false);
 if new.seller_code is not null then
  select is_qa into seller_qa from public.sales_representatives where code=new.seller_code;
  if coalesce(seller_qa,false)<>new.is_qa then raise exception 'QA sellers and customers cannot mix with real sales';end if;
 end if;
 return new;
end $$;
create trigger qa_sale_guard before insert or update on public.assisted_sales for each row execute function private.qa_sale_guard();
create function private.qa_event_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='profile_analytics_events' then
  if exists(select 1 from public.profiles where slug=new.profile_slug and is_qa) then return null;end if;
 else
  new.is_qa:=exists(select 1 from public.profiles where id=new.profile_id and is_qa)
   or exists(select 1 from auth.users where id=new.user_id and email like 'qa-e2e-%@example.invalid');
 end if;
 return new;
end $$;
create trigger qa_event_guard before insert on public.business_events for each row execute function private.qa_event_guard();
create trigger qa_event_guard before insert on public.profile_analytics_events for each row execute function private.qa_event_guard();
revoke all on function private.qa_identity_guard(),private.qa_sale_guard(),private.qa_event_guard() from public,anon,authenticated;
