-- Additive assisted-sales ledger. Existing gateway and entitlement functions are preserved.
create table public.assisted_sales (
 id uuid primary key,
 profile_id bigint not null references public.profiles(id) on delete restrict,
 customer_id uuid not null references auth.users(id) on delete restrict,
 customer_name text not null,
 seller_code text,
 plan text not null check(plan in ('personal','business','artist','creator')),
 list_price_mxn numeric(12,2) not null,
 amount_mxn numeric(12,2) not null check(amount_mxn>0),
 discount_note text not null default '',
 payment_method text not null check(payment_method in ('transferencia','efectivo','deposito','otro')),
 payment_reference text not null unique,
 payment_status text not null default 'paid' check(payment_status='paid'),
 paid_at timestamptz not null,
 activated_at timestamptz not null default now(),
 expires_at timestamptz not null,
 first_payment boolean not null,
 commission_mxn numeric(12,2) not null check(commission_mxn>=0),
 commission_status text not null check(commission_status in ('not_applicable','pending','paid')),
 commission_paid_at timestamptz,
 commission_reference text,
 recorded_by uuid not null references auth.users(id),
 constraint commission_consistency check ((commission_mxn=0 and commission_status='not_applicable') or (commission_mxn>0 and commission_status in ('pending','paid')))
);
create index assisted_sales_customer_idx on public.assisted_sales(customer_id);
create index assisted_sales_profile_idx on public.assisted_sales(profile_id);
alter table public.assisted_sales enable row level security;
revoke all on public.assisted_sales from anon,authenticated;
grant select on public.assisted_sales to authenticated;
create policy "Admins read assisted sales" on public.assisted_sales for select to authenticated using(exists(select 1 from public.admin_users where user_id=(select auth.uid())));

create function public.admin_record_assisted_sale(p_request_id uuid,p_profile_id bigint,p_plan text,p_amount numeric,p_seller_code text,p_method text,p_reference text,p_paid_at timestamptz,p_discount_note text)
returns public.assisted_sales language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); card public.profiles; sale public.assisted_sales; activated public.profiles;
 price numeric; first_paid boolean; seller text:=nullif(upper(trim(p_seller_code)),''); ref text:=upper(trim(p_reference));
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'Falta identificador de operación'; end if;
 select * into card from public.profiles where id=p_profile_id for update;
 if not found or card.account_role='team' or coalesce(card.demo_profile,false) then raise exception 'Cliente no válido'; end if;
 if card.user_id is null then raise exception 'Entrega primero la tarjeta a la cuenta confirmada del cliente'; end if;
 -- Also serialize legacy multiple-card accounts when deciding the first payment.
 perform 1 from auth.users where id=card.user_id for update;
 select * into sale from public.assisted_sales where id=p_request_id or payment_reference=ref;
 if found then
   if sale.profile_id is distinct from p_profile_id or sale.plan is distinct from p_plan or sale.amount_mxn is distinct from p_amount or sale.seller_code is distinct from seller or sale.payment_method is distinct from p_method or sale.payment_reference is distinct from ref or sale.paid_at is distinct from p_paid_at or sale.discount_note is distinct from coalesce(trim(p_discount_note),'') then raise exception 'El folio ya existe con otros datos'; end if;
   return sale;
 end if;
 if p_plan is null or p_plan not in ('personal','business','artist','creator') then raise exception 'Plan no válido'; end if;
 select (plan_prices->>p_plan)::numeric into price from public.business_settings where id='main';
 if price is null or price<=0 then raise exception 'Precio de lista no disponible'; end if;
 if p_amount is null or p_amount<=0 or p_amount>price or p_amount<>round(p_amount,2) then raise exception 'Importe no válido: debe ser mayor que cero y no superar el precio de lista'; end if;
 if p_amount<price and coalesce(trim(p_discount_note),'')='' then raise exception 'Describe la promoción o descuento aplicado'; end if;
 if p_method is null or p_method not in ('transferencia','efectivo','deposito','otro') or ref is null or length(ref)<3 or length(ref)>160 then raise exception 'Método y folio de pago requeridos'; end if;
 if p_paid_at is null or p_paid_at>now()+interval '5 minutes' then raise exception 'Fecha de pago no válida'; end if;
 if length(coalesce(seller,''))>60 or length(coalesce(p_discount_note,''))>500 then raise exception 'Texto demasiado largo'; end if;
 first_paid:=not exists(select 1 from public.assisted_sales where customer_id=card.user_id)
   and not exists(select 1 from public.payments where user_id=card.user_id and environment='production' and status in ('approved','refunded'));
 -- Reuse annual activation, atomically with the receipt. Any failure rolls everything back.
 select * into activated from public.admin_authorize_plan(p_profile_id,p_plan);
 insert into public.assisted_sales(id,profile_id,customer_id,customer_name,seller_code,plan,list_price_mxn,amount_mxn,discount_note,payment_method,payment_reference,paid_at,expires_at,first_payment,commission_mxn,commission_status,recorded_by)
 values(p_request_id,card.id,card.user_id,card.name,seller,p_plan,price,p_amount,coalesce(trim(p_discount_note),''),p_method,ref,p_paid_at,activated.current_period_end,first_paid,case when first_paid and seller is not null then round(p_amount*0.20,2) else 0 end,case when first_paid and seller is not null and round(p_amount*0.20,2)>0 then 'pending' else 'not_applicable' end,actor) returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'record_assisted_sale','assisted_sale',sale.id::text,jsonb_build_object('profile_id',card.id,'amount_mxn',sale.amount_mxn,'commission_mxn',sale.commission_mxn,'seller_code',seller));
 return sale;
end $$;
revoke all on function public.admin_record_assisted_sale(uuid,bigint,text,numeric,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_record_assisted_sale(uuid,bigint,text,numeric,text,text,text,timestamptz,text) to authenticated;

create function public.admin_mark_commission_paid(p_sale_id uuid,p_reference text)
returns public.assisted_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sale public.assisted_sales;
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501'; end if;
 if coalesce(length(trim(p_reference)),0)<3 or length(p_reference)>160 then raise exception 'Folio del pago de comisión requerido'; end if;
 select * into sale from public.assisted_sales where id=p_sale_id for update;
 if not found or sale.commission_mxn<=0 then raise exception 'No hay comisión por pagar'; end if;
 if sale.commission_status='paid' then return sale; end if;
 update public.assisted_sales set commission_status='paid',commission_paid_at=now(),commission_reference=trim(p_reference) where id=p_sale_id returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'commission_paid','assisted_sale',sale.id::text,jsonb_build_object('amount_mxn',sale.commission_mxn,'reference',sale.commission_reference));
 return sale;
end $$;
revoke all on function public.admin_mark_commission_paid(uuid,text) from public,anon;
grant execute on function public.admin_mark_commission_paid(uuid,text) to authenticated;
