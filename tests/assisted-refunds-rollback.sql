begin;
create temp table refund_results(test text,passed boolean) on commit drop;
create temp table refund_fixture(admin_id uuid,owner_id uuid,pid bigint,sid uuid) on commit drop;
insert into refund_fixture select user_id,gen_random_uuid(),null,null from public.admin_users limit 1;
insert into auth.users(id,email,email_confirmed_at,aud,role) select owner_id,'qa-refund-'||owner_id||'@example.invalid',now(),'authenticated','authenticated' from refund_fixture;
select set_config('request.jwt.claim.sub',(select admin_id::text from refund_fixture),true);
do $$ declare f refund_fixture;c public.profiles;s public.assisted_sales;r public.assisted_sales;renewal public.assisted_sales;begin
 select * into f from refund_fixture;
 select * into c from public.admin_create_card('qa-refund-'||substr(f.owner_id::text,1,8),'QA refund');
 perform public.admin_assign_profile_owner_server(f.admin_id,c.id,'qa-refund-'||f.owner_id||'@example.invalid');
 select * into s from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'creator',999,'QA','efectivo','QA-first-'||f.owner_id,now(),'');
 update refund_fixture set pid=c.id,sid=s.id;
 insert into refund_results values('entitlement_snapshot_saved',s.entitlement_before->>'plan'='free' and s.entitlement_before->>'status'='trial');
 select * into r from public.admin_record_assisted_refund(s.id,'QA-return-'||f.owner_id,'Devolución de prueba',now());
 insert into refund_results values('full_refund_cancels_pending_commission',r.payment_status='refunded' and r.commission_status='cancelled' and r.refund_access_action='restored');
 insert into refund_results select 'original_trial_restored',subscription_plan='free' and status='trial' and trial_ends_at=c.trial_ends_at from public.profiles where id=c.id;
 perform public.admin_record_assisted_refund(s.id,'QA-return-'||f.owner_id,'Devolución de prueba',now());
 insert into refund_results select 'duplicate_refund_no_second_change',subscription_plan='free' and trial_ends_at=c.trial_ends_at from public.profiles where id=c.id;
 begin
 perform public.admin_record_assisted_refund(s.id,'OTHER-REF','Devolución de prueba',now());insert into refund_results values('changed_refund_retry_rejected',false);
 exception when others then insert into refund_results values('changed_refund_retry_rejected',sqlerrm like 'La devolución ya existe%');end;
 begin
 perform public.admin_mark_commission_paid(s.id,'bad-payment');insert into refund_results values('cancelled_commission_cannot_be_paid',false);
 exception when others then insert into refund_results values('cancelled_commission_cannot_be_paid',sqlerrm like 'La comisión no puede%');end;
 -- A subsequent sale must not gain a second first-payment commission.
 select * into s from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',600,'QA','efectivo','QA-second-'||f.owner_id,now(),'');
 insert into refund_results values('refunded_first_sale_not_recommissioned',s.commission_mxn=0 and not s.first_payment);
 select * into renewal from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',600,'QA','efectivo','QA-renew-'||f.owner_id,now(),'');
 select * into r from public.admin_record_assisted_refund(renewal.id,'QA-renew-refund-'||f.owner_id,'Renovación devuelta',now());
 insert into refund_results select 'latest_renewal_refund_restores_previous_period',current_period_end=s.expires_at from public.profiles where id=c.id;
 -- Later effective purchase: refund is recorded but entitlement is preserved for review.
 select * into renewal from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'creator',999,'QA','efectivo','QA-later-'||f.owner_id,now(),'');
 select * into r from public.admin_record_assisted_refund(s.id,'QA-older-return-'||f.owner_id,'Devolución anterior',now());
 insert into refund_results values('older_refund_flagged_for_review',r.refund_access_action='review_required');
 insert into refund_results select 'later_purchase_preserved',subscription_plan='creator' and current_period_end=renewal.expires_at from public.profiles where id=c.id;
end $$;
-- Separate first buyer for commission already paid.
do $$ declare u uuid:=gen_random_uuid();c public.profiles;s public.assisted_sales;r public.assisted_sales;begin
 insert into auth.users(id,email,email_confirmed_at,aud,role) values(u,'qa-recover-'||u||'@example.invalid',now(),'authenticated','authenticated');
 select * into c from public.admin_create_card('qa-recover-'||substr(u::text,1,8),'QA recover');
 perform public.admin_assign_profile_owner_server((select admin_id from refund_fixture),c.id,'qa-recover-'||u||'@example.invalid');
 select * into s from public.admin_record_assisted_sale(gen_random_uuid(),c.id,'personal',500,'QA','efectivo','QA-paid-'||u,now(),'Descuento');
 perform public.admin_mark_commission_paid(s.id,'QA-commission-paid');
 select * into r from public.admin_record_assisted_refund(s.id,'QA-paid-return-'||u,'Devolución de prueba',now());
 insert into refund_results values('paid_commission_becomes_recovery_due',r.commission_status='recovery_due' and r.commission_mxn=100);
 select * into r from public.admin_mark_commission_recovered(s.id,'QA-recovered');
 insert into refund_results values('recovery_receipt_recorded',r.commission_status='recovered' and r.commission_recovery_reference='QA-recovered');
 perform public.admin_mark_commission_recovered(s.id,'QA-recovered');
 insert into refund_results values('recovery_idempotent',true);
end $$;
grant all on refund_fixture,refund_results to authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from refund_fixture),true);
set local role authenticated;
do $$ begin
 begin perform public.admin_record_assisted_refund((select sid from refund_fixture),'BAD-REF','Bad refund attempt',now());insert into refund_results values('customer_cannot_refund',false);exception when insufficient_privilege then insert into refund_results values('customer_cannot_refund',true);end;
 begin perform public.admin_mark_commission_recovered((select sid from refund_fixture),'BAD-REF');insert into refund_results values('customer_cannot_recover',false);exception when insufficient_privilege then insert into refund_results values('customer_cannot_recover',true);end;
end $$;
reset role;
insert into refund_results values('anon_cannot_refund',not has_function_privilege('anon','public.admin_record_assisted_refund(uuid,text,text,timestamptz)','EXECUTE'));
select * from refund_results;
rollback;
