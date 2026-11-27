-- Loy family organizer, slice 1: members, custody nights, items.
-- Additive only: creates the new "family" schema and touches nothing in
-- public (Loy Travel) or football (Broncos). Safe to run more than once.
-- Replace the emails: Dad = NEXT_PUBLIC_LOGIN_BASE, each boy = its "+name"
-- version. Create users with them in Supabase > Authentication > Users.

create schema if not exists family;

create table if not exists family.members (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  role text not null check (role in ('parent', 'kid')),
  email text unique,
  color text not null default '#64748b',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists family.custody_pattern (
  id int primary key default 1 check (id = 1),
  anchor_date date not null,
  anchor_house text not null check (anchor_house in ('dad', 'mom')),
  updated_at timestamptz not null default now()
);

create table if not exists family.custody_overrides (
  night date primary key,
  house text not null check (house in ('dad', 'mom', 'travel')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists family.items (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references family.members (id) on delete cascade,
  kind text not null default 'todo' check (kind in ('test', 'quiz', 'project', 'homework', 'meet', 'game', 'practice', 'event', 'appointment', 'todo')),
  title text not null check (length(title) between 1 and 200),
  due_on date not null,
  due_time time,
  notes text,
  done boolean not null default false,
  source text not null default 'manual',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_member_due_idx on family.items (member_id, due_on);

-- Who is signed in. Everyone in this Supabase project shares one sign-in
-- pool (Broncos parents, Loy Travel guests), so access is by the family
-- members list, never just "signed in".
create or replace function family.my_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id
  from family.members m
  join auth.users u on u.id = auth.uid()
  where u.email is not null
    and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
    and lower(m.email) = lower(u.email)
  limit 1
$$;

create or replace function family.is_parent() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from family.members m
    where m.id = family.my_member_id() and m.role = 'parent'
  )
$$;

revoke all on function family.my_member_id() from public, anon;
revoke all on function family.is_parent() from public, anon;
grant usage on schema family to authenticated;
grant execute on function family.my_member_id() to authenticated;
grant execute on function family.is_parent() to authenticated;
grant select, insert, update, delete on family.members, family.custody_pattern, family.custody_overrides, family.items to authenticated;

alter table family.members enable row level security;
alter table family.custody_pattern enable row level security;
alter table family.custody_overrides enable row level security;
alter table family.items enable row level security;

-- Members: the family can see the list; only the parent changes it.
drop policy if exists members_read on family.members;
create policy members_read on family.members for select to authenticated
  using (family.my_member_id() is not null);
drop policy if exists members_write on family.members;
create policy members_write on family.members for all to authenticated
  using (family.is_parent()) with check (family.is_parent());

-- Custody nights: everyone in the family sees them; only the parent edits.
drop policy if exists pattern_read on family.custody_pattern;
create policy pattern_read on family.custody_pattern for select to authenticated
  using (family.my_member_id() is not null);
drop policy if exists pattern_write on family.custody_pattern;
create policy pattern_write on family.custody_pattern for all to authenticated
  using (family.is_parent()) with check (family.is_parent());

drop policy if exists overrides_read on family.custody_overrides;
create policy overrides_read on family.custody_overrides for select to authenticated
  using (family.my_member_id() is not null);
drop policy if exists overrides_write on family.custody_overrides;
create policy overrides_write on family.custody_overrides for all to authenticated
  using (family.is_parent()) with check (family.is_parent());

-- Items: kids see and change only their own; the parent sees all.
drop policy if exists items_all on family.items;
create policy items_all on family.items for all to authenticated
  using (family.is_parent() or member_id = family.my_member_id())
  with check (family.is_parent() or member_id = family.my_member_id());

-- Seed: the four of you, and the custody anchor read from Google Calendar
-- ("Kids with Bryant" starts Fri Nov 13, 2026 and alternates weekly).
insert into family.members (slug, name, role, email, color, sort) values
  ('bryant',  'Bryant',  'parent', 'dad@example.com',     '#2563eb', 0),
  ('bryson',  'Bryson',  'kid',    'bryson@example.com',  '#16a34a', 1),
  ('bennett', 'Bennett', 'kid',    'bennett@example.com', '#ea580c', 2),
  ('brooks',  'Brooks',  'kid',    'brooks@example.com',  '#9333ea', 3)
on conflict (slug) do nothing;

insert into family.custody_pattern (id, anchor_date, anchor_house)
values (1, '2026-11-13', 'dad')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
