# Loy family organizer

A private PWA for Bryant and the boys: which house everyone is at each night,
plus tests, meets, games and to-dos per person.

- **Stack:** Next.js on Vercel (team "Bryant's personal stuff", project `loy-family-organizer`), Supabase (project `bryants-fun-projects`, schema `family`).
- **Who sees what:** Bryant (parent) sees every tab and can change custody nights.
  Each boy sees the Family tab and his own tab, and can add or check off only his own items.
  This is enforced by row-level security in `supabase/001_family_schema.sql`, keyed on a
  `family.members` list, because the Supabase project's sign-in pool is shared with other apps.
- **Mom (coparent):** sees the Family tab, custody weeks, every boy's tab and the Broncos games,
  and can add, change and check off the boys' items and change nights. Dad's own list stays his.
  Set up by `supabase/003_mom_login.sql`; her login is Dad's sign-in email with `+mom`.
- **Change alerts:** when Dad or Mom changes a boy's item or a night, a trigger logs it in
  `family.changes`. The other parent sees it in a "New from …" card on the Family tab, and gets a
  phone alert if they tapped "Turn on alerts". Alerts are sent by the Supabase Edge Function
  `supabase/functions/family-notify` (deploy with JWT verification off; it only sends what was
  logged). It makes its own push key pair on first run and keeps it in `family.push_keys`.
- **Want to talk?:** each boy has a private card at the top of his own tab to ask Dad, Mom or both
  for a talk, with an optional topic and short note (Brooks gets big face and emoji buttons). Only he
  and the parent(s) he picked can see it: a Mom-only ask is hidden from Dad's login and a Dad-only ask
  from Mom's. The phone alert says only "<name> would like to talk". The ask is deleted when he taps
  Never mind or when each parent he asked taps We talked. It's never logged in `family.changes`.
  Set up by `supabase/004_talk_requests.sql`; the app reaches the table only through its `talk_*` functions.
- **Custody nights:** the Google Calendar series "Kids with Bryant" / "Kids with Jessalyn"
  alternate every Friday. The app stores one anchor date (`family.custody_pattern`) and
  computes every night from it; tapping a night saves an exception in `family.custody_overrides`.
- **Broncos:** practices and games are read live from the Broncos app's `football.team_events`
  through `family.team_events()`, for teams linked in `family.team_links` (Brooks plays, Dad coaches).
  Edit the schedule in the Broncos app and it shows here. Kids see only their own teams.
- **School:** first ParentSquare items were added by hand in `supabase/002_broncos_and_school.sql`;
  automatic Gmail extraction comes later.

## Setup

1. Run `supabase/001_family_schema.sql` in the Supabase SQL editor (with real sign-in emails),
   then `supabase/002_broncos_and_school.sql`, then `supabase/003_mom_login.sql`, then `supabase/004_talk_requests.sql`.
2. Supabase > Project Settings > Data API > Exposed schemas: add `family`.
3. Supabase > Authentication > Users > Add user > Create new user, once per person,
   with the emails from step 1 (Mom: Dad's email with +mom) and "Auto Confirm User" ticked.
4. Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` (publishable key),
   `NEXT_PUBLIC_LOGIN_BASE` (Dad's sign-in email; the boys and Mom use its +bryson, +bennett, +brooks, +mom versions).
   The sign-in screen is "tap your name, then password", so nobody types an email.

## Develop

```
npm install
npm test        # custody date logic
npm run dev
```
