-- Additive refund receipts: records money already returned; never sends money.
alter table public.assisted_sales
 add column sale_sequence bigint generated always as identity,
 add column entitlement_before jsonb,
 add column refund_reference text unique,
 add column refund_reason text,
 add column refunded_at timestamptz,
 add column refund_recorded_at timestamptz,
 add column refund_recorded_by uuid references auth.users(id),
 add column refund_access_action text check(refund_access_action in ('restored','review_required')),
 add column commission_recovered_at timestamptz,
 add column commission_recovery_reference text;
alter table public.assisted_sales drop constraint assisted_sales_payment_status_check;
alter table public.assisted_sales add constraint assisted_sales_payment_status_check check(payment_status in ('paid','refunded'));
alter table public.assisted_sales drop constraint assisted_sales_commission_status_check;
alter table public.assisted_sales drop constraint commission_consistency;
alter table public.assisted_sales add constraint assisted_sales_commission_status_check check(commission_status in ('not_applicable','pending','paid','cancelled','recovery_due','recovered'));
alter table public.assisted_sales add constraint commission_consistency check((commission_mxn=0 and commission_status='not_applicable') or (commission_mxn>0 and commission_status in ('pending','paid','cancelled','recovery_due','recovered')));

create function public.admin_record_assisted_refund(p_sale_id uuid,p_reference text,p_reason text,p_refunded_at timestamptz)
returns public.assisted_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sale public.assisted_sales; card public.profiles; target_profile bigint;
 previous_plan text; previous_status text; previous_end timestamptz; previous_trial timestamptz; access_action text:='review_required';
 ref text:=upper(trim(p_reference)); reason text:=trim(p_reason);
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501'; end if;
 if coalesce(length(ref),0)<3 or length(ref)>160 or coalesce(length(reason),0)<5 or length(reason)>500 then raise exception 'Folio y motivo de devolución requeridos'; end if;
 if p_refunded_at is null or p_refunded_at>now()+interval '5 minutes' then raise exception 'Fecha de devolución no válida'; end if;
 select profile_id into target_profile from public.assisted_sales where id=p_sale_id;
 if not found then raise exception 'Venta no encontrada'; end if;
 select * into card from public.profiles where id=target_profile for update;
 select * into sale from public.assisted_sales where id=p_sale_id for update;
 if sale.payment_status='refunded' then
  if sale.refund_reference is distinct from ref or sale.refund_reason is distinct from reason or sale.refunded_at is distinct from p_refunded_at then raise exception 'La devolución ya existe con otros datos'; end if;
  return sale;
 end if;
 if p_refunded_at<sale.paid_at then raise exception 'La devolución no puede preceder al pago'; end if;
 -- Restore only the exact entitlement granted by this receipt. Preserve later purchases or edits.
 if sale.entitlement_before is not null and card.user_id=sale.customer_id and card.status='active'
 and card.subscription_plan=sale.plan and card.current_period_end=sale.expires_at
 and not exists(select 1 from public.assisted_sales s where s.profile_id=sale.profile_id and s.sale_sequence>sale.sale_sequence and s.payment_status='paid')
 and not exists(select 1 from public.assisted_sales s where s.profile_id=sale.profile_id and s.id<>sale.id and s.refund_access_action='review_required')
 and not exists(select 1 from public.payments p where p.profile_id=sale.profile_id and p.environment='production' and p.status='approved' and p.updated_at>=sale.activated_at)
 then
  previous_plan:=sale.entitlement_before->>'plan'; previous_status:=sale.entitlement_before->>'status';
  previous_end:=nullif(sale.entitlement_before->>'current_period_end','')::timestamptz;
  previous_trial:=nullif(sale.entitlement_before->>'trial_ends_at','')::timestamptz;
  if previous_plan not in ('free','personal','business','artist','creator') or previous_plan is null then raise exception 'Estado anterior no válido'; end if;
  if previous_status not in ('active','trial','suspended','expired') or previous_status is null then raise exception 'Estado anterior no válido'; end if;
  if (previous_plan<>'free' and (previous_end is null or previous_end<=now())) or (previous_status='trial' and (previous_trial is null or previous_trial<=now())) then
    previous_plan:='free'; previous_end:=null; previous_trial:=null;
    if previous_status in ('active','trial') then previous_status:='active'; end if;
  end if;
  update public.profiles set subscription_plan=previous_plan,status=previous_status,current_period_end=previous_end,trial_ends_at=previous_trial,updated_at=now() where id=card.id;
  access_action:='restored';
 end if;
 update public.assisted_sales set payment_status='refunded',refund_reference=ref,refund_reason=reason,refunded_at=p_refunded_at,refund_recorded_at=now(),refund_recorded_by=actor,refund_access_action=access_action,
 commission_status=case when commission_status='pending' then 'cancelled' when commission_status='paid' then 'recovery_due' else commission_status end
 where id=sale.id returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'assisted_sale_refunded','assisted_sale',sale.id::text,jsonb_build_object('amount_mxn',sale.amount_mxn,'reference',ref,'reason',reason,'access_action',access_action,'commission_status',sale.commission_status));
 return sale;
end $$;
revoke all on function public.admin_record_assisted_refund(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.admin_record_assisted_refund(uuid,text,text,timestamptz) to authenticated;

create function public.admin_mark_commission_recovered(p_sale_id uuid,p_reference text)
returns public.assisted_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sale public.assisted_sales; ref text:=trim(p_reference);
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501'; end if;
 if coalesce(length(ref),0)<3 or length(ref)>160 then raise exception 'Folio de recuperación requerido'; end if;
 select * into sale from public.assisted_sales where id=p_sale_id for update;
 if not found then raise exception 'Venta no encontrada'; end if;
 if sale.commission_status='recovered' then
  if sale.commission_recovery_reference is distinct from ref then raise exception 'Recuperación ya registrada con otro folio'; end if;
  return sale;
 end if;
 if sale.payment_status<>'refunded' or sale.commission_status<>'recovery_due' then raise exception 'No hay comisión pendiente de recuperar'; end if;
 update public.assisted_sales set commission_status='recovered',commission_recovered_at=now(),commission_recovery_reference=ref where id=sale.id returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'commission_recovered','assisted_sale',sale.id::text,jsonb_build_object('amount_mxn',sale.commission_mxn,'reference',ref));
 return sale;
end $$;
revoke all on function public.admin_mark_commission_recovered(uuid,text) from public,anon;
grant execute on function public.admin_mark_commission_recovered(uuid,text) to authenticated;

create or replace function public.admin_record_assisted_sale(p_request_id uuid,p_profile_id bigint,p_plan text,p_amount numeric,p_seller_code text,p_method text,p_reference text,p_paid_at timestamptz,p_discount_note text)
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
 insert into public.assisted_sales(id,profile_id,customer_id,customer_name,seller_code,plan,list_price_mxn,amount_mxn,discount_note,payment_method,payment_reference,paid_at,expires_at,first_payment,commission_mxn,commission_status,recorded_by,entitlement_before)
 values(p_request_id,card.id,card.user_id,card.name,seller,p_plan,price,p_amount,coalesce(trim(p_discount_note),''),p_method,ref,p_paid_at,activated.current_period_end,first_paid,case when first_paid and seller is not null then round(p_amount*0.20,2) else 0 end,case when first_paid and seller is not null and round(p_amount*0.20,2)>0 then 'pending' else 'not_applicable' end,actor,jsonb_build_object('plan',card.subscription_plan,'status',card.status,'current_period_end',card.current_period_end,'trial_ends_at',card.trial_ends_at)) returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'record_assisted_sale','assisted_sale',sale.id::text,jsonb_build_object('profile_id',card.id,'amount_mxn',sale.amount_mxn,'commission_mxn',sale.commission_mxn,'seller_code',seller));
 return sale;
end $$;

create or replace function public.admin_mark_commission_paid(p_sale_id uuid,p_reference text)
returns public.assisted_sales language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sale public.assisted_sales;
begin
 if actor is null or not exists(select 1 from public.admin_users where user_id=actor) then raise exception 'Solo administradores' using errcode='42501'; end if;
 if coalesce(length(trim(p_reference)),0)<3 or length(p_reference)>160 then raise exception 'Folio del pago de comisión requerido'; end if;
 select * into sale from public.assisted_sales where id=p_sale_id for update;
 if not found or sale.commission_mxn<=0 then raise exception 'No hay comisión por pagar'; end if;
 if sale.payment_status<>'paid' or sale.commission_status not in ('pending','paid') then raise exception 'La comisión no puede pagarse en este estado'; end if;
 if sale.commission_status='paid' then return sale; end if;
 update public.assisted_sales set commission_status='paid',commission_paid_at=now(),commission_reference=trim(p_reference) where id=p_sale_id returning * into sale;
 insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details) values(actor,'commission_paid','assisted_sale',sale.id::text,jsonb_build_object('amount_mxn',sale.commission_mxn,'reference',sale.commission_reference));
 return sale;
end $$;
