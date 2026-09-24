-- Incremental change against the audited production schema; not a fresh baseline.
-- Keep already-published customer cards visible during the expiry-to-Free transition.
alter policy "Public reads available profiles" on public.profiles using (
 (account_role='customer' and demo_profile=false and status in ('active','trial'))
 or (status='active' and (current_period_end is null or current_period_end>now()))
 or (status='trial' and trial_ends_at is not null and trial_ends_at>now())
);
alter policy "Owners and admins read profiles" on public.profiles using (
 user_id=(select auth.uid()) or created_by=(select auth.uid())
 or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))
 or (account_role='customer' and demo_profile=false and status in ('active','trial'))
 or (status='active' and (current_period_end is null or current_period_end>now()))
 or (status='trial' and trial_ends_at is not null and trial_ends_at>now())
);
CREATE OR REPLACE FUNCTION private.apply_verified_payment(p_payment_id uuid, p_provider_payment_id text, p_status text, p_provider_payload jsonb)
 RETURNS TABLE(status text, current_period_end timestamp with time zone, activation_applied boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_payment public.payments%rowtype; v_profile public.profiles%rowtype; v_new_end timestamptz;
 v_claimed boolean:=false; v_previous_status text; v_plan text; v_payload jsonb; v_refund_applied boolean:=false;
 v_old_plan text; v_old_end timestamptz; v_plan_changed boolean:=false; v_before jsonb; v_restore_plan text; v_restore_end timestamptz;
begin
 if p_status not in ('pending','approved','rejected','cancelled','refunded') then raise exception 'invalid payment status'; end if;
 select * into v_payment from public.payments where id=p_payment_id for update;
 if not found then raise exception 'payment not found'; end if;
 v_previous_status:=v_payment.status;
 if v_previous_status in ('approved','refunded') and v_payment.provider_payment_id is not null and v_payment.provider_payment_id is distinct from p_provider_payment_id then
   raise exception 'payment provider reference mismatch';
 end if;
 -- A delayed approval must never revive an already refunded payment.
 if v_previous_status='refunded' then
   return query select v_previous_status,pr.current_period_end,false
   from public.profiles pr where pr.id=v_payment.profile_id;
   return;
 end if;
 select * into v_profile from public.profiles where id=v_payment.profile_id and user_id=v_payment.user_id for update;
 if not found then raise exception 'profile not found'; end if;
 v_plan:=coalesce(v_payment.provider_payload->>'plan','');
 if v_plan not in ('personal','business','artist','creator') and p_status='approved' then raise exception 'invalid or missing purchased plan'; end if;
 v_payload:=coalesce(v_payment.provider_payload,'{}'::jsonb)||jsonb_build_object('gateway',coalesce(p_provider_payload,'{}'::jsonb));
 if v_previous_status='approved' and p_status='approved' then return query select v_previous_status,v_profile.current_period_end,false; return; end if;
 if v_previous_status='approved' and p_status='refunded' then
   update public.payments set status='refunded',provider_payment_id=p_provider_payment_id,provider_payload=v_payload,updated_at=now() where id=v_payment.id;
   if not exists(select 1 from public.payments p2 where p2.profile_id=v_payment.profile_id and p2.id<>v_payment.id and p2.status='approved' and p2.sequence_no>v_payment.sequence_no) then
     v_before:=v_payment.provider_payload->'entitlement_before';
     if v_before is not null then
       v_restore_plan:=coalesce(v_before->>'plan','free');
       if v_restore_plan not in ('free','personal','business','artist','creator') then v_restore_plan:='free'; end if;
       begin v_restore_end:=nullif(v_before->>'current_period_end','')::timestamptz; exception when others then v_restore_end:=null; end;
       if v_restore_plan='free' or (v_restore_end is not null and v_restore_end<=now()) then v_restore_plan:='free'; v_restore_end:=null; end if;
       update public.profiles set subscription_plan=v_restore_plan,status='active',current_period_end=v_restore_end,updated_at=now() where id=v_profile.id;
     else
       update public.profiles set subscription_plan='free',status='active',current_period_end=null,updated_at=now() where id=v_profile.id;
       v_restore_plan:='free'; v_restore_end:=null;
     end if;
     v_refund_applied:=true;
   end if;
   insert into public.business_events(user_id,profile_id,event_type,metadata)
   values(v_payment.user_id,v_payment.profile_id,'payment_refunded',jsonb_build_object('payment_id',v_payment.id,'provider_payment_id',p_provider_payment_id,'environment',v_payment.environment,'plan',nullif(v_plan,''),'access_reverted',v_refund_applied,'restored_plan',v_restore_plan,'restored_period_end',v_restore_end));
   return query select 'refunded'::text,(case when v_refund_applied then v_restore_end else v_profile.current_period_end end),false; return;
 end if;
 if v_previous_status='approved' then return query select v_previous_status,v_profile.current_period_end,false; return; end if;
 if p_status='approved' then
   v_old_plan:=coalesce(v_profile.subscription_plan,'free'); v_old_end:=v_profile.current_period_end; v_plan_changed:=v_old_plan<>v_plan;
   v_payload:=v_payload||jsonb_build_object('entitlement_before',jsonb_build_object('plan',v_old_plan,'current_period_end',v_old_end,'status',v_profile.status));
 end if;
 update public.payments set provider_payment_id=p_provider_payment_id,status=p_status,provider_payload=v_payload,updated_at=now() where id=v_payment.id;
 if p_status='approved' then
   if v_old_plan=v_plan and v_old_end is not null and v_old_end>now() then v_new_end:=v_old_end+interval '1 year'; else v_new_end:=now()+interval '1 year'; end if;
   update public.profiles set status='active',subscription_plan=v_plan,current_period_end=v_new_end,updated_at=now() where id=v_profile.id;
   v_claimed:=true;
   insert into public.business_events(user_id,profile_id,event_type,metadata)
   values(v_payment.user_id,v_payment.profile_id,case when v_plan_changed then 'plan_changed' else 'payment_approved' end,jsonb_build_object('payment_id',v_payment.id,'provider_payment_id',p_provider_payment_id,'environment',v_payment.environment,'plan',v_plan,'previous_plan',v_old_plan,'previous_period_end',v_old_end,'current_period_end',v_new_end));
 elsif p_status='rejected' and v_previous_status is distinct from 'rejected' then
   insert into public.business_events(user_id,profile_id,event_type,metadata)
   values(v_payment.user_id,v_payment.profile_id,'payment_rejected',jsonb_build_object('payment_id',v_payment.id,'provider_payment_id',p_provider_payment_id,'environment',v_payment.environment,'plan',nullif(v_plan,'')));
 end if;
 return query select p_status,case when p_status='approved' then v_new_end else v_profile.current_period_end end,v_claimed;
end $function$;
