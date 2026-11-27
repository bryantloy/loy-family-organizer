-- Loy family organizer, slice 2: Broncos schedule + first school items.
-- Additive only: one new table and one read function in "family", plus
-- school items in family.items. Nothing in football (Broncos app) or public
-- (Loy Travel) is changed; the Broncos schedule is read live from
-- football.team_events, so edits in the Broncos app show up here too.
-- Safe to run more than once.

-- Who is on which team in the Broncos app (by team slug).
create table if not exists family.team_links (
  member_id uuid not null references family.members (id) on delete cascade,
  team_slug text not null,
  role text not null default 'player' check (role in ('player', 'coach')),
  primary key (member_id, team_slug)
);

alter table family.team_links enable row level security;
grant select, insert, update, delete on family.team_links to authenticated;

drop policy if exists team_links_read on family.team_links;
create policy team_links_read on family.team_links for select to authenticated
  using (family.my_member_id() is not null);
drop policy if exists team_links_write on family.team_links;
create policy team_links_write on family.team_links for all to authenticated
  using (family.is_parent()) with check (family.is_parent());

-- Team practices and games for the signed-in family member. Dad sees every
-- linked team's events; a boy sees only events for teams he is linked to.
-- Runs as the owner so it can read football.team_events, and filters to the
-- family list itself, so nobody else in the shared sign-in pool gets rows.
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
    and (family.is_parent() or l.member_id = family.my_member_id())
  group by e.id, t.name
  order by e.starts_at
$$;

revoke all on function family.team_events(date) from public, anon;
grant execute on function family.team_events(date) to authenticated;

-- Brooks plays on the OB Broncos 8U; Dad coaches it.
insert into family.team_links (member_id, team_slug, role)
select id, 'loy-8u', case when slug = 'bryant' then 'coach' else 'player' end
from family.members where slug in ('bryant', 'brooks')
on conflict do nothing;

-- First school items, read from ParentSquare and league mail (Nov 2026).
insert into family.items (member_id, kind, title, due_on, due_time, notes, source)
select m.id, v.kind, v.title, v.due_on::date, v.due_time::time, v.notes, v.source
from (values
  ('bryson', 'project', 'English: Fahrenheit 451 essay', '2026-12-11', null,
   'Ms. Leighton (ParentSquare, Nov 20): written before midterms. Exact day not given yet.', 'parentsquare'),
  ('bryson', 'homework', 'English: Q2 vocab notebook check + Quill sentences', '2026-12-11', null,
   'Ms. Leighton: these count as 100s only if complete on time. Exact day not given yet.', 'parentsquare'),
  ('bryson', 'test', 'Midterm exams start (about)', '2026-12-14', null,
   'Ms. Leighton: two regular weeks after Thanksgiving break, then midterms. Check the exam schedule.', 'parentsquare'),
  ('bennett', 'practice', 'MS soccer practice at the new sports pavilion', '2026-12-01', null,
   'Coach Lambrecht (ParentSquare, Nov 20): same time, new place, because the NAIA championship is on the usual field.', 'parentsquare'),
  ('bennett', 'practice', 'MS soccer practice at the new sports pavilion', '2026-12-03', null,
   'Coach Lambrecht (ParentSquare, Nov 20): same time, new place, because the NAIA championship is on the usual field.', 'parentsquare'),
  ('brooks', 'game', 'Broncos playoff (top 4 seeds only)', '2027-01-30', '09:00',
   'League email Nov 16: top four seeds play the Jan 30 tournament, games at 9, 10 and 11 AM on Field 9. Seeding sets the time.', 'league_email')
) as v (slug, kind, title, due_on, due_time, notes, source)
join family.members m on m.slug = v.slug
where not exists (
  select 1 from family.items i
  where i.member_id = m.id and i.title = v.title and i.due_on = v.due_on::date
);

notify pgrst, 'reload schema';
