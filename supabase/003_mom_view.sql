-- Loy family organizer, slice 3: a read-only login for the boys' mom.
-- Additive only: one new role ("viewer"), one helper function, one Mom row,
-- and read rules that let a viewer see the boys' items and Broncos games.
-- A viewer can't add, change or check off anything, can't change custody
-- nights, and doesn't see Dad's own list. The boys' access is unchanged.
-- Safe to run more than once.

-- 1. Allow the new role.
alter table family.members drop constraint if exists members_role_check;
alter table family.members add constraint members_role_check
  check (role in ('parent', 'kid', 'viewer'));

-- 2. Is the signed-in person a viewer (Mom)?
create or replace function family.is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from family.members m
    where m.id = family.my_member_id() and m.role = 'viewer'
  )
$$;
revoke all on function family.is_viewer() from public, anon;
grant execute on function family.is_viewer() to authenticated;

-- 3. Items: reading and writing are split. Read: Dad sees all, a boy sees his
-- own, a viewer sees every boy's. Write: Dad, or a boy on his own items only.
drop policy if exists items_all on family.items;
drop policy if exists items_read on family.items;
create policy items_read on family.items for select to authenticated
  using (
    family.is_parent()
    or member_id = family.my_member_id()
    or (family.is_viewer() and exists (
      select 1 from family.members k where k.id = member_id and k.role = 'kid'))
  );
drop policy if exists items_write on family.items;
create policy items_write on family.items for all to authenticated
  using (family.is_parent() or (member_id = family.my_member_id() and not family.is_viewer()))
  with check (family.is_parent() or (member_id = family.my_member_id() and not family.is_viewer()));

-- 4. Broncos games: a viewer sees the boys' teams (not Dad's coach link).
create or replace function family.team_events(since date default current_date)
returns table (
  id uuid,
  team_name text,
  title text,
  kind text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  notes text,
  member_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  select e.id, t.name, e.title, e.event_type, e.starts_at, e.ends_at, e.location, e.notes,
         array_agg(l.member_id order by m.sort)
  from football.team_events e
  join football.teams t on t.id = e.team_id
  join family.team_links l on l.team_slug = t.slug
  join family.members m on m.id = l.member_id
  where family.my_member_id() is not null
    and e.starts_at >= (since::timestamp at time zone 'America/Chicago')
    and (family.is_parent()
         or l.member_id = family.my_member_id()
         or (family.is_viewer() and m.role = 'kid'))
  group by e.id, t.name
  order by e.starts_at
$$;
revoke all on function family.team_events(date) from public, anon;
grant execute on function family.team_events(date) to authenticated;

-- 5. Mom. Her login is Dad's sign-in email with "+mom" added
-- (for example name+mom@gmail.com), the same way the boys' logins work.
insert into family.members (slug, name, role, email, color, sort)
select 'mom', 'Mom', 'viewer', regexp_replace(lower(email), '@', '+mom@'), '#db2777', 4
from family.members where slug = 'bryant'
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
