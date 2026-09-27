-- One authoritative photo on the main team card. JSON and demo columns are
-- compatibility replicas, maintained in the same transaction as the editor save.
-- Membership is private, ID-based and never derived from editable JSON or sales codes.
create table private.team_photo_members (
  profile_id bigint primary key references public.profiles(id) on delete cascade,
  source_profile_id bigint not null references public.profiles(id) on delete cascade
);
create index team_photo_members_source_idx on private.team_photo_members(source_profile_id);
alter table private.team_photo_members enable row level security;
revoke all on private.team_photo_members from public, anon, authenticated;

with people(main_slug, demo_prefix) as (values
 ('pablo-garza','pablo'), ('andrea-garza','andrea'), ('anapaula','anapaula'),
 ('francisco-aguilar','francisco'), ('rafael-orta','rafael'), ('claudia-almaraz','claudia')
)
insert into private.team_photo_members(profile_id,source_profile_id)
select member.id, main.id
from people
join public.profiles main on main.slug=people.main_slug
  and main.account_role='team' and not main.demo_profile
join public.profiles member on member.account_role='team' and (
  member.id=main.id or (member.demo_profile and member.slug in (
    'demo-'||people.demo_prefix||'-free', 'demo-'||people.demo_prefix||'-personal',
    'demo-'||people.demo_prefix||'-business', 'demo-'||people.demo_prefix||'-artista',
    'demo-'||people.demo_prefix||'-creator')));

do $$ begin
 if (select count(*) from private.team_photo_members)<>36
 or (select count(distinct source_profile_id) from private.team_photo_members)<>6 then
   raise exception 'Expected six existing team cards and their thirty demos; no changes applied';
 end if;
end $$;

create function private.normalize_team_photo() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_id bigint; photo text;
begin
 select m.source_profile_id into source_id from private.team_photo_members m where m.profile_id=new.id;
 if source_id is null or new.account_role<>'team' then return new; end if;
 if source_id=new.id then
   -- The editor writes both values. Support old JSON-only clients too, while
   -- giving an explicitly changed photo_url precedence over conflicting JSON.
   if new.photo_url is distinct from old.photo_url then photo:=new.photo_url;
   elsif new.data->>'photo' is distinct from old.data->>'photo' then photo:=new.data->>'photo';
   else photo:=new.photo_url;
   end if;
 else
   -- A stale demo edit may never restore an independent/old photo.
   select p.photo_url into photo from public.profiles p where p.id=source_id and p.account_role='team' and not p.demo_profile;
   if not found then raise exception 'Team photo source is unavailable'; end if;
 end if;
 new.photo_url:=coalesce(photo,'');
 new.data:=jsonb_set(coalesce(new.data,'{}'::jsonb),'{photo}',to_jsonb(new.photo_url),true);
 return new;
end $$;
revoke all on function private.normalize_team_photo() from public,anon,authenticated;

create function private.replicate_team_photo() returns trigger
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if new.account_role<>'team' or new.demo_profile
 or new.photo_url is not distinct from old.photo_url
 or not exists(select 1 from private.team_photo_members m where m.profile_id=new.id and m.source_profile_id=new.id)
 then return new; end if;
 -- Only the already authorized main-card editor can cause the narrow fan-out.
 -- Backend maintenance is allowed only via service_role or a trusted SQL session.
 if uid is null then
   if coalesce(auth.jwt()->>'role','')<>'service_role' and session_user not in ('postgres','supabase_admin') then
     raise exception 'Authentication required' using errcode='42501';
   end if;
 elsif uid is distinct from old.user_id and uid is distinct from old.created_by
   and not exists(select 1 from public.admin_users a where a.user_id=uid) then
   raise exception 'Not authorized to update this team photo' using errcode='42501';
 end if;
 update public.profiles p
 set photo_url=new.photo_url,
     data=jsonb_set(coalesce(p.data,'{}'::jsonb),'{photo}',to_jsonb(new.photo_url),true),
     updated_at=now()
 from private.team_photo_members m
 where m.source_profile_id=new.id and m.profile_id=p.id and p.id<>new.id
   and p.account_role='team' and p.demo_profile
   and (p.photo_url is distinct from new.photo_url or p.data->>'photo' is distinct from new.photo_url);
 return new;
end $$;
revoke all on function private.replicate_team_photo() from public,anon,authenticated;

create trigger team_photo_normalize before update of photo_url,data on public.profiles
for each row execute function private.normalize_team_photo();
create trigger team_photo_replicate after update of photo_url,data on public.profiles
for each row execute function private.replicate_team_photo();

-- Preserve currently selected photographs, including Andrea's choice. Do not
-- substitute the old portrait. Her corrupt asset awaits replacement by the user.
update public.profiles p set photo_url=coalesce(nullif(p.data->>'photo',''),p.photo_url,'')
from private.team_photo_members m where m.profile_id=p.id and m.source_profile_id=p.id;
update public.profiles p set photo_url=source.photo_url
from private.team_photo_members m join public.profiles source on source.id=m.source_profile_id
where p.id=m.profile_id and p.id<>m.source_profile_id;
