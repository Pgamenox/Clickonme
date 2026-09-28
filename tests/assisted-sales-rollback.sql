begin;
create temp table sales_results(test text,passed boolean) on commit drop;
create temp table sales_fixture(admin_id uuid,owner_id uuid,pid bigint,sid uuid,until_date timestamptz) on commit drop;
insert into sales_fixture select user_id,gen_random_uuid(),null,gen_random_uuid(),null from public.admin_users limit 1;
insert into auth.users(id,email,email_confirmed_at,aud,role) select owner_id,'qa-sale-'||owner_id||'@example.invalid',now(),'authenticated','authenticated' from sales_fixture;
select set_config('request.jwt.claim.sub',(select admin_id::text from sales_fixture),true);
do $$ declare c public.profiles; s public.assisted_sales; r public.assisted_sales; f sales_fixture; begin
 select * into f from sales_fixture;
 select * into c from public.admin_create_card('qa-sales-'||substr(f.owner_id::text,1,8),'QA sales rollback');
 update sales_fixture set pid=c.id;
 begin
 perform public.admin_record_assisted_sale(f.sid,c.id,'personal',500,'QA-SELLER','efectivo','QA-'||f.sid,now(),'Descuento');
 insert into sales_results values('unowned_card_blocked',false);
 exception when others then insert into sales_results values('unowned_card_blocked',sqlerrm like 'Entrega primero%'); end;
 perform public.admin_assign_profile_owner_server(f.admin_id,c.id,'qa-sale-'||f.owner_id||'@example.invalid');
 select * into s from public.admin_record_assisted_sale(f.sid,c.id,'personal',500.50,'QA-SELLER','efectivo','QA-'||f.sid,now(),'Descuento QA');
 insert into sales_results values('commission_20_percent_actual_amount',s.commission_mxn=100.10 and s.commission_status='pending' and s.first_payment);
 insert into sales_results select 'annual_activation_and_receipt_atomic',p.status='active' and p.subscription_plan='personal' and p.current_period_end=s.expires_at and s.expires_at=now()+interval '1 year' from public.profiles p where p.id=c.id;
 update sales_fixture set until_date=s.expires_at;
 select * into r from public.admin_record_assisted_sale(f.sid,c.id,'personal',500.50,'QA-SELLER','efectivo','QA-'||f.sid,now(),'Descuento QA');
 insert into sales_results values('same_request_idempotent',r.id=s.id and r.expires_at=s.expires_at);
 select * into r from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',500.50,'QA-SELLER','efectivo','QA-'||f.sid,now(),'Descuento QA');
 insert into sales_results values('same_receipt_new_request_idempotent',r.id=s.id and r.expires_at=s.expires_at);
 begin
 perform public.admin_record_assisted_sale(f.sid,c.id,'personal',400,'QA-SELLER','efectivo','QA-'||f.sid,now(),'Descuento QA');
 insert into sales_results values('changed_retry_rejected',false);
 exception when others then insert into sales_results values('changed_retry_rejected',sqlerrm like 'El folio ya existe%');end;
 select * into r from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',600,'QA-SELLER','transferencia','QA-renew-'||f.sid,now(),'');
 insert into sales_results values('renewal_zero_commission',not r.first_payment and r.commission_mxn=0 and r.commission_status='not_applicable' and r.expires_at=s.expires_at+interval '1 year');
 select * into r from public.admin_mark_commission_paid(s.id,'QA-payout');
 insert into sales_results values('commission_payment_recorded',r.commission_status='paid' and r.commission_paid_at is not null and r.commission_reference='QA-payout');
 select * into r from public.admin_mark_commission_paid(s.id,'QA-payout');
 insert into sales_results values('commission_payment_idempotent',r.commission_status='paid');
 begin
 perform public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',0,'QA','efectivo','QA-zero-'||f.sid,now(),'');
 insert into sales_results values('zero_payment_rejected',false);
 exception when others then insert into sales_results values('zero_payment_rejected',sqlerrm like 'Importe no válido%');end;
 begin
 perform public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',400,'QA','efectivo','QA-discount-'||f.sid,now(),'');
 insert into sales_results values('discount_requires_reason',false);
 exception when others then insert into sales_results values('discount_requires_reason',sqlerrm like 'Describe la promoción%');end;
 insert into sales_results select 'rejected_requests_do_not_extend',current_period_end=s.expires_at+interval '1 year' from public.profiles where id=c.id;
end $$;
grant all on sales_fixture,sales_results to authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from sales_fixture),true);
set local role authenticated;
insert into sales_results select 'customer_cannot_read_ledger',count(*)=0 from public.assisted_sales;
do $$ begin
 begin
 perform public.admin_mark_commission_paid((select sid from sales_fixture),'bad-request');
 insert into sales_results values('customer_cannot_mark_commission',false);
 exception when insufficient_privilege then insert into sales_results values('customer_cannot_mark_commission',true);end;
 begin
 perform public.admin_record_assisted_sale(gen_random_uuid(),(select pid from sales_fixture),'creator',999,'QA','efectivo','bad-request',now(),'');
 insert into sales_results values('customer_cannot_record_sale',false);
 exception when insufficient_privilege then insert into sales_results values('customer_cannot_record_sale',true);end;
end $$;
reset role;
insert into sales_results values('anonymous_cannot_record_sale',not has_function_privilege('anon','public.admin_record_assisted_sale(uuid,bigint,text,numeric,text,text,text,timestamptz,text)','EXECUTE'));
insert into sales_results values('authenticated_cannot_write_ledger_directly',not has_table_privilege('authenticated','public.assisted_sales','INSERT,UPDATE,DELETE'));
select * from sales_results;
rollback;
