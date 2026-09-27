begin;
create temp table manual_results(test text,passed boolean) on commit drop;
do $$
declare admin_id uuid; owner_id uuid:=gen_random_uuid(); card public.profiles; until_date timestamptz;
begin
 select user_id into admin_id from public.admin_users limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 insert into auth.users(id,email,email_confirmed_at,aud,role) values(owner_id,'qa-manual-'||owner_id||'@example.invalid',now(),'authenticated','authenticated');
 select * into card from public.admin_create_card('qa-manual-'||substr(owner_id::text,1,8),'QA reversible');
 insert into manual_results values('prospect_created_unowned',card.user_id is null and card.status='trial');
 begin
 perform public.admin_assign_profile_owner_server(admin_id,card.id,'qa-manual-'||owner_id||'@example.invalid');
 insert into manual_results select 'delivered_to_confirmed_account',user_id=owner_id from public.profiles where id=card.id;
 exception when others then insert into manual_results values('delivery_failed: '||sqlerrm,false);
 end;
 perform public.admin_authorize_plan(card.id,'personal');
 select current_period_end into until_date from public.profiles where id=card.id;
 insert into manual_results select 'manual_annual_activation',status='active' and subscription_plan='personal' and current_period_end=now()+interval '1 year' from public.profiles where id=card.id;
 perform public.admin_authorize_plan(card.id,'personal');
 insert into manual_results select 'manual_renewal_adds_year',current_period_end=until_date+interval '1 year' from public.profiles where id=card.id;
 perform public.admin_set_profile_suspension(card.id,true);
 insert into manual_results select 'manual_suspension',status='suspended' from public.profiles where id=card.id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 begin
 perform public.admin_authorize_plan(card.id,'creator');
 insert into manual_results values('customer_cannot_authorize',false);
 exception when insufficient_privilege then insert into manual_results values('customer_cannot_authorize',true);
 end;
end $$;
select * from manual_results;
rollback;
