-- Loy family organizer, slice 4: the boys' private "Want to talk?" button.
-- A boy asks Dad, Mom or both for a talk, with an optional topic and short
-- note. Only the boy and the parent(s) he picked can see it: brothers never
-- do, a Mom-only ask is hidden from Dad's login and a Dad-only ask from
-- Mom's (Dad normally sees everything; this table is the exception).
-- Nobody reads the table directly: everything goes through the functions
-- below, which check who's asking. Asks are never written to family.changes.
-- An ask is deleted when the boy taps Never mind, or when every parent he
-- asked has tapped We talked. Additive only, safe to run more than once.

create table if not exists family.talk_requests (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null unique references family.members (id) on delete cascade,
  to_dad boolean not null,
  to_mom boolean not null,
  topic text check (topic in ('talk', 'school', 'friends', 'bugging')),
  note text check (length(note) <= 280),
  created_at timestamptz not null default now(),
  dad_seen_at timestamptz,
  mom_seen_at timestamptz,
  dad_done_at timestamptz,
  mom_done_at timestamptz,
  pushed_at timestamptz,
  check (to_dad or to_mom)
);
alter table family.talk_requests enable row level security;
-- No policies and no grants: the app can't select, add or change rows
-- directly, even from Dad's login.
revoke all on family.talk_requests from public, anon, authenticated;

-- Which side the signed-in grown-up is on: 'dad', 'mom' or null.
create or replace function family.talk_side() returns text
language sql stable security definer set search_path = '' as $$
  select case when family.is_parent() then 'dad' when family.is_coparent() then 'mom' end
$$;

-- A boy sends (or replaces) his ask. p_to is 'dad', 'mom' or 'both'.
create or replace function family.talk_ask(p_to text, p_topic text default null, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := family.my_member_id();
  n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null or family.member_role(me) <> 'kid' then raise exception 'Only the boys can send this.'; end if;
  if p_to not in ('dad', 'mom', 'both') then raise exception 'Pick Dad, Mom or both.'; end if;
  insert into family.talk_requests (kid_id, to_dad, to_mom, topic, note)
  values (me, p_to in ('dad', 'both'), p_to in ('mom', 'both'), nullif(p_topic, ''), left(n, 280))
  on conflict (kid_id) do update set
    to_dad = excluded.to_dad, to_mom = excluded.to_mom, topic = excluded.topic, note = excluded.note,
    created_at = now(), dad_seen_at = null, mom_seen_at = null, dad_done_at = null, mom_done_at = null,
    pushed_at = null;
end
$$;

-- The boy's own open ask, if any.
create or replace function family.talk_mine()
returns table (to_dad boolean, to_mom boolean, topic text, note text, created_at timestamptz,
               dad_seen boolean, mom_seen boolean, dad_done boolean, mom_done boolean)
language sql stable security definer set search_path = '' as $$
  select t.to_dad, t.to_mom, t.topic, t.note, t.created_at,
         t.dad_seen_at is not null, t.mom_seen_at is not null,
         t.dad_done_at is not null, t.mom_done_at is not null
  from family.talk_requests t
  where t.kid_id = family.my_member_id()
$$;

-- "Never mind": the boy takes his ask back.
create or replace function family.talk_cancel() returns void
language sql volatile security definer set search_path = '' as $$
  delete from family.talk_requests where kid_id = family.my_member_id()
$$;

-- Asks waiting for the signed-in parent: Dad sees only asks to Dad (or
-- both), Mom only asks to Mom (or both).
create or replace function family.talk_inbox()
returns table (id uuid, kid_name text, kid_color text, topic text, note text, created_at timestamptz,
               seen boolean, also_other boolean, other_done boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, m.name, m.color, t.topic, t.note, t.created_at,
         case family.talk_side() when 'dad' then t.dad_seen_at is not null else t.mom_seen_at is not null end,
         t.to_dad and t.to_mom,
         case family.talk_side() when 'dad' then t.mom_done_at is not null else t.dad_done_at is not null end
  from family.talk_requests t
  join family.members m on m.id = t.kid_id
  where (family.talk_side() = 'dad' and t.to_dad and t.dad_done_at is null)
     or (family.talk_side() = 'mom' and t.to_mom and t.mom_done_at is null)
  order by t.created_at
$$;

-- Seen: lets the boy know his parent saw it.
create or replace function family.talk_seen(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update family.talk_requests t set
    dad_seen_at = case when family.talk_side() = 'dad' and t.to_dad then coalesce(t.dad_seen_at, now()) else t.dad_seen_at end,
    mom_seen_at = case when family.talk_side() = 'mom' and t.to_mom then coalesce(t.mom_seen_at, now()) else t.mom_seen_at end
  where t.id = p_id
$$;

-- We talked: clears it for this parent; the ask is deleted once every
-- parent it went to has tapped it.
create or replace function family.talk_done(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  side text := family.talk_side();
begin
  if side is null then return; end if;
  update family.talk_requests t set
    dad_done_at = case when side = 'dad' and t.to_dad then now() else t.dad_done_at end,
    mom_done_at = case when side = 'mom' and t.to_mom then now() else t.mom_done_at end
  where t.id = p_id;
  delete from family.talk_requests t
  where t.id = p_id
    and (not t.to_dad or t.dad_done_at is not null)
    and (not t.to_mom or t.mom_done_at is not null);
end
$$;

-- For the family-notify function only: takes the asks not alerted yet
-- (from the last hour) and returns just the boy's name and who to alert.
-- The topic and note never leave the database this way.
create or replace function family.claim_talk_alerts()
returns table (kid_name text, kid_id uuid, to_dad boolean, to_mom boolean)
language sql volatile security definer set search_path = '' as $$
  with c as (
    update family.talk_requests t set pushed_at = now()
    where t.pushed_at is null and t.created_at > now() - interval '1 hour'
    returning t.kid_id, t.to_dad, t.to_mom
  )
  select m.name, c.kid_id, c.to_dad, c.to_mom from c join family.members m on m.id = c.kid_id
$$;

revoke all on function family.talk_side() from public, anon;
revoke all on function family.talk_ask(text, text, text) from public, anon;
revoke all on function family.talk_mine() from public, anon;
revoke all on function family.talk_cancel() from public, anon;
revoke all on function family.talk_inbox() from public, anon;
revoke all on function family.talk_seen(uuid) from public, anon;
revoke all on function family.talk_done(uuid) from public, anon;
revoke all on function family.claim_talk_alerts() from public, anon, authenticated;
grant execute on function family.talk_side() to authenticated;
grant execute on function family.talk_ask(text, text, text) to authenticated;
grant execute on function family.talk_mine() to authenticated;
grant execute on function family.talk_cancel() to authenticated;
grant execute on function family.talk_inbox() to authenticated;
grant execute on function family.talk_seen(uuid) to authenticated;
grant execute on function family.talk_done(uuid) to authenticated;
grant execute on function family.claim_talk_alerts() to service_role;

notify pgrst, 'reload schema';
