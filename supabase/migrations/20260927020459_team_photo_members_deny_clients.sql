-- Explicit deny documents the private, trigger-only membership table.
create policy team_photo_members_no_client_access on private.team_photo_members
for all to anon,authenticated using(false) with check(false);
