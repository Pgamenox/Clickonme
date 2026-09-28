create table public.sales_representatives(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 2 and 120),
 code text not null unique check(code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
 active boolean not null default true,
 commission_percent numeric(5,2) not null default 20 check(commission_percent between 0 and 100),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.sales_representatives enable row level security;
revoke all on public.sales_representatives from anon,authenticated;
grant select on public.sales_representatives to authenticated;
create policy "Admins read sellers" on public.sales_representatives for select to authenticated using(exists(select 1 from public.admin_users where user_id=(select auth.uid())));
alter table public.assisted_sales add column seller_id uuid references public.sales_representatives(id) on delete restrict,add column seller_name_snapshot text,add column commission_percent numeric(5,2);
create index assisted_sales_seller_idx on public.assisted_sales(seller_id);

create function public.admin_save_sales_representative(p_id uuid,p_name text,p_code text,p_active boolean,p_commission_percent numeric default 20)
returns public.sales_representatives language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); seller public.sales_representatives; code_value text:=upper(trim(p_code));
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 2 and 120 or p_active is null or p_commission_percent is null or p_commission_percent<0 or p_commission_percent>100 or p_commission_percent<>round(p_commission_percent,2) then raise exception 'Nombre, estado o porcentaje no válido';end if;
 if p_id is null then
  insert into public.sales_representatives(name,code,active,commission_percent) values(trim(p_name),code_value,p_active,p_commission_percent) returning * into seller;
 else
  select * into seller from public.sales_representatives where id=p_id for update;
  if not found then raise exception 'Vendedor no encontrado';end if;
  if seller.code is distinct from code_value then raise exception 'El código es permanente; no puede cambiarse';end if;
  update public.sales_representatives set name=trim(p_name),active=p_active,commission_percent=p_commission_percent,updated_at=now() where id=p_id returning * into seller;
 end if;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'save_sales_representative','seller',seller.id::text,jsonb_build_object('name',seller.name,'code',seller.code,'active',seller.active,'commission_percent',seller.commission_percent));
 return seller;
end $$;
revoke all on function public.admin_save_sales_representative(uuid,text,text,boolean,numeric) from public,anon;
grant execute on function public.admin_save_sales_representative(uuid,text,text,boolean,numeric) to authenticated;

-- Public clients must now select an immutable seller ID. The legacy routine is internal only.
revoke execute on function public.admin_record_assisted_sale(uuid,bigint,text,numeric,text,text,text,timestamptz,text) from authenticated;
create function public.admin_record_catalog_sale(p_request_id uuid,p_profile_id bigint,p_plan text,p_amount numeric,p_seller_id uuid,p_method text,p_reference text,p_paid_at timestamptz,p_discount_note text)
returns public.assisted_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); seller public.sales_representatives; sale public.assisted_sales; rate numeric:=0; fee numeric:=0;
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501';end if;
 select * into sale from public.assisted_sales where id=p_request_id or payment_reference=upper(trim(p_reference));
 if found then
  if sale.seller_id is distinct from p_seller_id then raise exception 'El folio ya existe con otro vendedor';end if;
  -- Existing receipts retain their original name, rate and seller even after deactivation.
  return public.admin_record_assisted_sale(p_request_id,p_profile_id,p_plan,p_amount,sale.seller_code,p_method,p_reference,p_paid_at,p_discount_note);
 end if;
 if p_seller_id is not null then
  select * into seller from public.sales_representatives where id=p_seller_id for share;
  if not found or not seller.active then raise exception 'Selecciona un vendedor activo del catálogo';end if;
  rate:=seller.commission_percent;
 end if;
 select * into sale from public.admin_record_assisted_sale(p_request_id,p_profile_id,p_plan,p_amount,seller.code,p_method,p_reference,p_paid_at,p_discount_note);
 -- A concurrent retry may have completed the same receipt while we waited for the profile lock.
 if sale.commission_percent is not null then
  if sale.seller_id is distinct from p_seller_id then raise exception 'El folio ya existe con otro vendedor';end if;
  return sale;
 end if;
 if sale.first_payment and p_seller_id is not null then fee:=round(sale.amount_mxn*rate/100,2);end if;
 update public.assisted_sales set seller_id=p_seller_id,seller_name_snapshot=seller.name,commission_percent=case when sale.first_payment then rate else 0 end,commission_mxn=fee,commission_status=case when fee>0 then 'pending' else 'not_applicable' end where id=sale.id returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'catalog_sale_commission','assisted_sale',sale.id::text,jsonb_build_object('seller_id',sale.seller_id,'seller_code',sale.seller_code,'commission_percent',sale.commission_percent,'commission_mxn',sale.commission_mxn));
 return sale;
end $$;
revoke all on function public.admin_record_catalog_sale(uuid,bigint,text,numeric,uuid,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_record_catalog_sale(uuid,bigint,text,numeric,uuid,text,text,timestamptz,text) to authenticated;
