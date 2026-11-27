# Loy family organizer

A private PWA for Bryant and the boys: which house everyone is at each night,
plus tests, meets, games and to-dos per person.

- **Stack:** Next.js on Vercel, Supabase (project `bryants-fun-projects`, schema `family`).
- **Who sees what:** Bryant (parent) sees every tab and can change custody nights.
  Each boy sees the Family tab and his own tab, and can add or check off only his own items.
  This is enforced by row-level security in `supabase/001_family_schema.sql`, keyed on a
  `family.members` list, because the Supabase project's sign-in pool is shared with other apps.
- **Custody nights:** the Google Calendar series "Kids with Bryant" / "Kids with Jessalyn"
  alternate every Friday. The app stores one anchor date (`family.custody_pattern`) and
  computes every night from it; tapping a night saves an exception in `family.custody_overrides`.

## Setup

1. Run `supabase/001_family_schema.sql` in the Supabase SQL editor (with real sign-in emails).
2. Supabase > Project Settings > Data API > Exposed schemas: add `family`.
3. Supabase > Authentication > Users > Add user > Create new user, once per person,
   with the emails from step 1 and "Auto Confirm User" ticked.
4. Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` (publishable key),
   `NEXT_PUBLIC_LOGIN_BASE` (Dad's sign-in email; the boys use its +bryson, +bennett, +brooks versions).
   The sign-in screen is "tap your name, then password", so nobody types an email.

## Develop

```
npm install
npm test        # custody date logic
npm run dev
```
