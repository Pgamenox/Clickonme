-- Parallel administrative path for ClickOnMe.
-- This function is intentionally NOT executable by anon/authenticated.
-- Only service_role may invoke it, normally from the admin-profile-actions Edge Function.

create or replace function public.admin_profile_action_server(
  p_admin_user_id uuid,
  p_action text,
  p_profile_id bigint,
  p_plan text default null,
  p_confirm_slug text default null,
  p_suspended boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action text := lower(trim(coalesce(p_action,'')));
  v_plan text := lower(trim(coalesce(p_plan,'')));
  v_old public.profiles;
  v_new public.profiles;
  v_end timestamptz;
begin
  if p_admin_user_id is null
     or not exists (select 1 from public.admin_users where user_id=p_admin_user_id)
  then
    raise exception 'admin required' using errcode='42501';
  end if;

  if v_action not in ('authorize_plan','set_suspension','delete_profile') then
    raise exception 'invalid action';
  end if;

  select * into v_old from public.profiles where id=p_profile_id for update;
  if not found then raise exception 'profile not found'; end if;

  if v_old.account_role='team' or coalesce(v_old.demo_profile,false) then
    raise exception 'internal profiles cannot be modified here';
  end if;

  if v_action='authorize_plan' then
    if v_plan not in ('personal','business','artist','creator') then raise exception 'invalid plan'; end if;
    if v_old.subscription_plan=v_plan and v_old.current_period_end>now()
      then v_end:=v_old.current_period_end+interval '1 year';
      else v_end:=now()+interval '1 year';
    end if;

    update public.profiles
       set subscription_plan=v_plan,status='active',trial_ends_at=null,
           current_period_end=v_end,updated_at=now()
     where id=p_profile_id returning * into v_new;

    insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details)
    values(p_admin_user_id,'authorize_plan','profile',p_profile_id::text,
      jsonb_build_object('previous_plan',v_old.subscription_plan,'new_plan',v_plan,
        'previous_period_end',v_old.current_period_end,'new_period_end',v_end,'source','edge_admin'));

    return jsonb_build_object('ok',true,'action',v_action,'profile_id',v_new.id,'slug',v_new.slug,
      'status',v_new.status,'subscription_plan',v_new.subscription_plan,'current_period_end',v_new.current_period_end);
  end if;

  if v_action='set_suspension' then
    if p_suspended is null then raise exception 'suspension flag required'; end if;

    update public.profiles
       set status=case when p_suspended then 'suspended' else 'active' end,updated_at=now()
     where id=p_profile_id returning * into v_new;

    insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details)
    values(p_admin_user_id,case when p_suspended then 'suspend_profile' else 'reactivate_profile' end,
      'profile',p_profile_id::text,
      jsonb_build_object('previous_status',v_old.status,'new_status',v_new.status,'source','edge_admin'));

    return jsonb_build_object('ok',true,'action',v_action,'profile_id',v_new.id,'slug',v_new.slug,'status',v_new.status);
  end if;

  if coalesce(p_confirm_slug,'')<>v_old.slug then raise exception 'confirmation slug mismatch'; end if;

  insert into public.admin_audit_log(admin_user_id,action,entity_type,entity_id,details)
  values(p_admin_user_id,'delete_profile','profile',p_profile_id::text,
    jsonb_build_object('slug',v_old.slug,'name',v_old.name,'plan',v_old.subscription_plan,
      'status',v_old.status,'source','edge_admin'));

  delete from public.profiles where id=p_profile_id;

  return jsonb_build_object('ok',true,'action',v_action,'profile_id',p_profile_id,'slug',v_old.slug,'deleted',true);
end
$function$;

revoke all on function public.admin_profile_action_server(uuid,text,bigint,text,text,boolean) from public;
revoke all on function public.admin_profile_action_server(uuid,text,bigint,text,text,boolean) from anon;
revoke all on function public.admin_profile_action_server(uuid,text,bigint,text,text,boolean) from authenticated;
grant execute on function public.admin_profile_action_server(uuid,text,bigint,text,text,boolean) to service_role;
