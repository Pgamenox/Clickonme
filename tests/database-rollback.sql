begin;
create temp table closure_results(test text, passed boolean) on commit drop;
create temp table closure_fixture(uid uuid, other_uid uuid, pid bigint, payment1 uuid, payment2 uuid, end1 timestamptz) on commit drop;
insert into closure_fixture values(gen_random_uuid(),gen_random_uuid(),-924260001,gen_random_uuid(),gen_random_uuid(),null);
insert into auth.users(id,aud,role) select uid,'authenticated','authenticated' from closure_fixture union all select other_uid,'authenticated','authenticated' from closure_fixture;
insert into public.profiles(id,slug,name,user_id,created_by,status,subscription_plan,account_role,demo_profile,trial_ends_at)
select pid,'qa-closure-'||substr(uid::text,1,8),'QA rollback only',uid,uid,'active','free','customer',false,null from closure_fixture;
insert into public.payments(id,user_id,profile_id,external_reference,amount_mxn,status,environment,provider_payload,sequence_no)
select payment1,uid,pid,'qa-closure-'||payment1::text,399,'created','test','{"plan":"personal"}',-924260002 from closure_fixture;
select * from private.apply_verified_payment((select payment1 from closure_fixture),'qa-closure-pay-1','approved','{}');
update closure_fixture set end1=(select current_period_end from public.profiles where id=closure_fixture.pid);
insert into closure_results select 'activation',subscription_plan='personal' and current_period_end>now() from public.profiles where id=(select pid from closure_fixture);
select * from private.apply_verified_payment((select payment1 from closure_fixture),'qa-closure-pay-1','approved','{}');
insert into closure_results select 'duplicate_approval_does_not_extend',p.current_period_end=f.end1 from public.profiles p join closure_fixture f on p.id=f.pid;
insert into public.payments(id,user_id,profile_id,external_reference,amount_mxn,status,environment,provider_payload,sequence_no)
select payment2,uid,pid,'qa-closure-'||payment2::text,399,'created','test','{"plan":"personal"}',-924260001 from closure_fixture;
select * from private.apply_verified_payment((select payment2 from closure_fixture),'qa-closure-pay-2','approved','{}');
insert into closure_results select 'renewal_adds_one_year',p.current_period_end=f.end1+interval '1 year' from public.profiles p join closure_fixture f on p.id=f.pid;
select * from private.apply_verified_payment((select payment2 from closure_fixture),'qa-closure-pay-2','refunded','{}');
insert into closure_results select 'refund_restores_previous_period',p.current_period_end=f.end1 from public.profiles p join closure_fixture f on p.id=f.pid;
select * from private.apply_verified_payment((select payment2 from closure_fixture),'qa-closure-pay-2','refunded','{}');
insert into closure_results select 'duplicate_refund_does_not_change_period',p.current_period_end=f.end1 from public.profiles p join closure_fixture f on p.id=f.pid;
select * from private.apply_verified_payment((select payment2 from closure_fixture),'qa-closure-pay-2','approved','{}');
insert into closure_results select 'refunded_payment_cannot_reactivate',status='refunded' from public.payments where id=(select payment2 from closure_fixture);
insert into closure_results values('client_cannot_execute_payment_gateway',not has_function_privilege('authenticated','public.apply_verified_payment_gateway(uuid,text,text,jsonb)','EXECUTE'));
grant all on closure_results,closure_fixture to authenticated,anon;
select set_config('request.jwt.claim.sub',(select uid::text from closure_fixture),true);
set local role authenticated;
do $$ begin
 begin
 update public.profiles set subscription_plan='creator',current_period_end=now()+interval '10 years' where id=(select pid from closure_fixture);
 exception when insufficient_privilege then null;
 end;
 insert into closure_results select 'client_cannot_change_plan',subscription_plan='personal' from public.profiles where id=(select pid from closure_fixture);
 begin
 insert into public.profiles(id,slug,name,user_id) select pid-1,'qa-duplicate-'||substr(uid::text,1,8),'QA duplicate',uid from closure_fixture;
 insert into closure_results values('one_account_one_card',false);
 exception when unique_violation then insert into closure_results values('one_account_one_card',true);
 end;
end $$;
select set_config('request.jwt.claim.sub',(select other_uid::text from closure_fixture),true);
with changed as (update public.profiles set name='Unauthorized' where id=(select pid from closure_fixture) returning id)
insert into closure_results select 'other_user_cannot_update',count(*)=0 from changed;
reset role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare newid uuid:=gen_random_uuid(); begin
 insert into public.payments(id,user_id,profile_id,external_reference,amount_mxn,status,environment,provider_payload,sequence_no)
 select newid,uid,pid,'qa-change-'||newid::text,599,'created','test','{"plan":"business"}',-924260000 from closure_fixture;
 perform private.apply_verified_payment(newid,'qa-rejected-attempt','rejected','{}');
 perform private.apply_verified_payment(newid,'qa-successful-retry','approved','{}');
 insert into closure_results select 'plan_change_after_failed_payment_attempt',subscription_plan='business' and current_period_end=now()+interval '1 year' from public.profiles where id=(select pid from closure_fixture);
 perform private.apply_verified_payment(newid,'qa-successful-retry','refunded','{}');
 insert into closure_results select 'plan_change_refund_restores_previous_plan',subscription_plan='personal' from public.profiles where id=(select pid from closure_fixture);
end $$;
update public.profiles set current_period_end=now()-interval '1 minute' where id=(select pid from closure_fixture);
set local role anon;
insert into closure_results select 'expired_customer_remains_public',count(*)=1 from public.profiles where slug=(select 'qa-closure-'||substr(uid::text,1,8) from closure_fixture);
reset role;
select * from private.process_expired_subscriptions();
insert into closure_results select 'expiry_downgrades_to_free',subscription_plan='free' and status='active' and current_period_end is null from public.profiles where id=(select pid from closure_fixture);
update public.profiles set status='suspended' where id=(select pid from closure_fixture);
set local role anon;
insert into closure_results select 'suspended_customer_is_not_public',count(*)=0 from public.profiles where slug=(select 'qa-closure-'||substr(uid::text,1,8) from closure_fixture);
reset role;
select * from closure_results;
rollback;
