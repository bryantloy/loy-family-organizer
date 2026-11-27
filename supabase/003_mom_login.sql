-- Loy family organizer, slice 3: a login for the boys' mom, plus change alerts.
-- Mom ("coparent") sees the Family tab, custody weeks, every boy's tab and the
-- Broncos games, and can add, change and check off the boys' items and change
-- nights. She doesn't see Dad's own list. When Dad or Mom changes something,
-- it's logged in family.changes so the other one gets an alert. The boys'
-- access is unchanged. Additive only, safe to run more than once.

-- 1. Allow the new role ("viewer" was the first, view-only draft of Mom's
-- login; her row is moved to "coparent" at the end).
alter table family.members drop constraint if exists members_role_check;
alter table family.members add constraint members_role_check
  check (role in ('parent', 'kid', 'coparent', 'viewer'));

-- 2. Helpers.
create or replace function family.is_coparent() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from family.members m
    where m.id = family.my_member_id() and m.role = 'coparent'
  )
$$;

create or replace function family.member_role(mid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from family.members m where m.id = mid
$$;

revoke all on function family.is_coparent() from public, anon;
revoke all on function family.member_role(uuid) from public, anon;
grant execute on function family.is_coparent() to authenticated;
grant execute on function family.member_role(uuid) to authenticated;

-- 3. Items. Read: Dad all, a boy his own, Mom every boy's.
-- Write: Dad any, Mom any boy's, a boy his own.
drop policy if exists items_all on family.items;
drop policy if exists items_read on family.items;
create policy items_read on family.items for select to authenticated
  using (
    family.is_parent()
    or member_id = family.my_member_id()
    or (family.is_coparent() and family.member_role(member_id) = 'kid')
  );
drop policy if exists items_write on family.items;
create policy items_write on family.items for all to authenticated
  using (
    family.is_parent()
    or (family.member_role(member_id) = 'kid'
        and (family.is_coparent() or member_id = family.my_member_id()))
  )
  with check (
    family.is_parent()
    or (family.member_role(member_id) = 'kid'
        and (family.is_coparent() or member_id = family.my_member_id()))
  );

-- 4. Custody nights: Dad or Mom can change a night.
drop policy if exists overrides_write on family.custody_overrides;
create policy overrides_write on family.custody_overrides for all to authenticated
  using (family.is_parent() or family.is_coparent())
  with check (family.is_parent() or family.is_coparent());

-- 5. Broncos games: Mom sees the boys' teams (not Dad's coach link).
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
         or (family.is_coparent() and m.role = 'kid'))
  group by e.id, t.name
  order by e.starts_at
$$;
revoke all on function family.team_events(date) from public, anon;
grant execute on function family.team_events(date) to authenticated;

-- The view-only draft's helper is no longer used.
drop function if exists family.is_viewer();

-- 6. Change log. Filled only by the triggers below, when Dad or Mom changes
-- one of the boys' items or a night. Only Dad and Mom can read it.
create table if not exists family.changes (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references family.members (id) on delete set null,
  summary text not null,
  pushed_at timestamptz
);
create index if not exists changes_at_idx on family.changes (at desc);
alter table family.changes enable row level security;
grant select on family.changes to authenticated;
drop policy if exists changes_read on family.changes;
create policy changes_read on family.changes for select to authenticated
  using (family.is_parent() or family.is_coparent());

create or replace function family.log_item_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := family.my_member_id();
  r record := case when tg_op = 'DELETE' then old else new end;
  kid text;
  what text;
begin
  if actor is null or family.member_role(actor) not in ('parent', 'coparent') then return null; end if;
  if family.member_role(r.member_id) <> 'kid' then return null; end if;
  select m.name into kid from family.members m where m.id = r.member_id;
  what := kid || '''s ' || r.title || ' (' || to_char(r.due_on, 'Dy Mon FMDD') || ')';
  if tg_op = 'INSERT' then what := 'added ' || what;
  elsif tg_op = 'DELETE' then what := 'deleted ' || what;
  elsif new.done is distinct from old.done then
    what := case when new.done then 'checked off ' else 'unchecked ' end || what;
  else what := 'changed ' || what;
  end if;
  insert into family.changes (actor_id, summary) values (actor, what);
  return null;
end
$$;

create or replace function family.log_night_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := family.my_member_id();
  d date := case when tg_op = 'DELETE' then old.night else new.night end;
  what text;
begin
  if actor is null or family.member_role(actor) not in ('parent', 'coparent') then return null; end if;
  if tg_op = 'DELETE' then
    what := 'put ' || to_char(d, 'Dy Mon FMDD') || ' back to the regular week';
  else
    what := 'set ' || to_char(d, 'Dy Mon FMDD') || ' to '
      || case new.house when 'dad' then 'Dad''s house' when 'mom' then 'Mom''s house' else 'travel' end;
  end if;
  insert into family.changes (actor_id, summary) values (actor, what);
  return null;
end
$$;

revoke all on function family.log_item_change() from public, anon, authenticated;
revoke all on function family.log_night_change() from public, anon, authenticated;

drop trigger if exists items_log on family.items;
create trigger items_log after insert or update or delete on family.items
  for each row execute function family.log_item_change();
drop trigger if exists nights_log on family.custody_overrides;
create trigger nights_log after insert or update or delete on family.custody_overrides
  for each row execute function family.log_night_change();

-- 7. "New from Mom / Dad" in the app: what the other one changed since you
-- last tapped Got it.
create table if not exists family.change_seen (
  member_id uuid primary key references family.members (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table family.change_seen enable row level security;

create or replace function family.unseen_changes()
returns table (id bigint, at timestamptz, actor_name text, summary text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.at, m.name, c.summary
  from family.changes c
  join family.members m on m.id = c.actor_id
  where (family.is_parent() or family.is_coparent())
    and c.actor_id <> family.my_member_id()
    and c.at > coalesce(
      (select s.seen_at from family.change_seen s where s.member_id = family.my_member_id()),
      now() - interval '7 days')
  order by c.at desc
  limit 30
$$;

create or replace function family.mark_changes_seen() returns void
language sql volatile security definer set search_path = '' as $$
  insert into family.change_seen (member_id, seen_at)
  select family.my_member_id(), now()
  where family.is_parent() or family.is_coparent()
  on conflict (member_id) do update set seen_at = excluded.seen_at
$$;

-- 8. Phone alerts. Each phone that turns alerts on saves its push address
-- here; the family-notify function (Supabase Edge Functions) sends to them.
-- Nobody reads this table from the app.
create table if not exists family.push_subscriptions (
  endpoint text primary key,
  member_id uuid not null references family.members (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table family.push_subscriptions enable row level security;

create or replace function family.save_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not (family.is_parent() or family.is_coparent()) then return; end if;
  insert into family.push_subscriptions (endpoint, member_id, p256dh, auth)
  values (p_endpoint, family.my_member_id(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end
$$;

create or replace function family.drop_push(p_endpoint text) returns void
language sql volatile security definer set search_path = '' as $$
  delete from family.push_subscriptions
  where endpoint = p_endpoint and member_id = family.my_member_id()
$$;

-- The alert key pair. family-notify makes it the first time it runs and
-- keeps it here; only that function can read it.
create table if not exists family.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
alter table family.push_keys enable row level security;
revoke all on family.push_keys from public, anon, authenticated;

revoke all on function family.unseen_changes() from public, anon;
revoke all on function family.mark_changes_seen() from public, anon;
revoke all on function family.save_push(text, text, text) from public, anon;
revoke all on function family.drop_push(text) from public, anon;
grant execute on function family.unseen_changes() to authenticated;
grant execute on function family.mark_changes_seen() to authenticated;
grant execute on function family.save_push(text, text, text) to authenticated;
grant execute on function family.drop_push(text) to authenticated;
grant usage on schema family to service_role;
grant select, update, delete on family.changes, family.push_subscriptions to service_role;
grant select on family.members to service_role;
grant select, insert on family.push_keys to service_role;

-- 9. Mom. Her login is Dad's sign-in email with "+mom" added
-- (for example name+mom@gmail.com), the same way the boys' logins work.
insert into family.members (slug, name, role, email, color, sort)
select 'mom', 'Mom', 'coparent', regexp_replace(lower(email), '@', '+mom@'), '#db2777', 4
from family.members where slug = 'bryant'
on conflict (slug) do nothing;
update family.members set role = 'coparent' where slug = 'mom' and role <> 'coparent';

notify pgrst, 'reload schema';
