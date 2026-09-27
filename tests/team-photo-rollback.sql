begin;
create temp table photo_results(test text,passed boolean) on commit drop;
create temp table photo_before as select id,photo_url,data,slug,user_id,account_role,demo_profile from public.profiles;
grant all on photo_results to authenticated,anon;
-- Every existing collaborator can update their main card, even though demos
-- are owned by the administrator. All changes below are rolled back.
do $$ declare source record; photo text; begin
 for source in select p.* from public.profiles p join private.team_photo_members m on m.profile_id=p.id and m.source_profile_id=p.id loop
  perform set_config('request.jwt.claim.sub',source.user_id::text,true);
  execute 'set local role authenticated';
  photo:='https://example.test/qa-team-photo-'||source.id;
  update public.profiles set photo_url=photo,data=jsonb_set(data,'{photo}',to_jsonb(photo)) where id=source.id;
  execute 'reset role';
  insert into photo_results select 'six_replicas_'||source.slug,count(*)=6 and bool_and(p.photo_url=photo and p.data->>'photo'=photo)
    from public.profiles p join private.team_photo_members m on m.profile_id=p.id where m.source_profile_id=source.id;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','',true);
insert into photo_results select 'demo_designs_preserved',bool_and((p.data-'photo')=(b.data-'photo'))
from public.profiles p join photo_before b using(id) where p.demo_profile;
insert into photo_results select 'unrelated_profiles_unchanged',bool_and(p.photo_url is not distinct from b.photo_url and p.data=b.data)
from public.profiles p join photo_before b using(id) where not exists(select 1 from private.team_photo_members m where m.profile_id=p.id);
insert into photo_results select 'ownership_and_card_count_preserved',
 (select count(*) from public.profiles)=(select count(*) from photo_before)
 and bool_and(p.user_id is not distinct from b.user_id and p.account_role=b.account_role and p.demo_profile=b.demo_profile)
 from public.profiles p join photo_before b using(id);
-- Stale demo writes cannot create a second photo source.
update public.profiles set photo_url='https://example.test/stale',data=jsonb_set(data,'{photo}','"https://example.test/stale"') where slug='demo-andrea-free';
insert into photo_results select 'stale_demo_cannot_override_photo',d.photo_url=p.photo_url and d.data->>'photo'=p.photo_url
from public.profiles d,public.profiles p where d.slug='demo-andrea-free' and p.slug='andrea-garza';
-- Anonymous and unrelated users cannot use the fan-out to edit another team.
select set_config('request.jwt.claim.sub',user_id::text,true) from public.profiles where slug='anapaula';
set local role authenticated;
with changed as(update public.profiles set photo_url='https://example.test/unauthorized' where slug='andrea-garza' returning id)
insert into photo_results select 'other_owner_cannot_edit_andrea',count(*)=0 from changed;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin
  update public.profiles set photo_url='https://example.test/anonymous' where slug='andrea-garza';
  insert into photo_results values('anonymous_cannot_edit',not found);
 exception when insufficient_privilege then insert into photo_results values('anonymous_cannot_edit',true);
 end;
end $$;
reset role;
insert into photo_results values
 ('private_membership_not_writable',not has_table_privilege('authenticated','private.team_photo_members','INSERT,UPDATE,DELETE')),
 ('private_fanout_not_callable',not has_function_privilege('authenticated','private.replicate_team_photo()','EXECUTE')),
 ('private_normalizer_not_callable',not has_function_privilege('anon','private.normalize_team_photo()','EXECUTE')),
 ('one_customer_card_constraint_preserved',exists(select 1 from pg_indexes where schemaname='public' and indexname='profiles_one_customer_card_per_user'));
do $$ begin if exists(select 1 from photo_results where not coalesce(passed,false)) then raise exception 'Team photo regression failed'; end if; end $$;
select * from photo_results;
rollback;
