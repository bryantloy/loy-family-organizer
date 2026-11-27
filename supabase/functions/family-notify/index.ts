// family-notify: sends Dad or Mom a phone alert when the other one changes
// a night or one of the boys' items, or when a boy taps "Want to talk?". The app calls it after a change; it
// sends only what the database logged in family.changes and hasn't sent yet,
// so calling it again (or by anyone) sends nothing new.
// { "action": "key" } returns the public alert key the app subscribes with.
// The key pair is made on first use and kept in family.push_keys, which only
// this function can read, so no secret is ever typed or shown anywhere.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'family' },
    auth: { persistSession: false },
  });

  // The alert key pair: read it, or make it the first time.
  let { data: keys } = await db.from('push_keys').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (!keys) {
    const k = webpush.generateVAPIDKeys();
    await db.from('push_keys').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
    ({ data: keys } = await db.from('push_keys').select('public_key, private_key').eq('id', 1).maybeSingle());
  }
  if (!keys) return json({ error: 'Alerts are not set up yet.' }, 500);

  let action = '';
  try { action = (await req.json())?.action || ''; } catch { /* no body */ }
  if (action === 'key') return json({ publicKey: keys.public_key });

  webpush.setVapidDetails('https://loy-family-organizer-loti.vercel.app', keys.public_key, keys.private_key);

  const { data: members } = await db.from('members').select('id, name, role');
  const byId = new Map((members || []).map((m) => [m.id, m]));
  const parents = (members || []).filter((m) => m.role === 'parent' || m.role === 'coparent');
  let sent = 0;

  async function sendTo(memberIds: string[], payload: string) {
    if (!memberIds.length) return;
    const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').in('member_id', memberIds);
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }
  }

  // A boy's "Want to talk?" ask. The alert says only who wants to talk; the
  // topic and note stay in the app (this function never gets them).
  const { data: talks } = await db.rpc('claim_talk_alerts');
  for (const t of talks || []) {
    const targets = parents
      .filter((p) => (p.role === 'parent' && t.to_dad) || (p.role === 'coparent' && t.to_mom))
      .map((p) => p.id);
    await sendTo(targets, JSON.stringify({ title: 'Loy Family', body: `${t.kid_name} would like to talk`, tag: `talk-${t.kid_id}` }));
  }

  // Claim unsent changes from the last hour (older ones just show in the app).
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: claimed, error } = await db
    .from('changes')
    .update({ pushed_at: new Date().toISOString() })
    .is('pushed_at', null)
    .gte('at', since)
    .select('id, actor_id, summary, at');
  if (error) return json({ error: error.message }, 500);
  if (!claimed?.length) return json({ sent });

  const byActor = new Map<string, typeof claimed>();
  for (const c of claimed.sort((a, b) => a.at.localeCompare(b.at))) {
    if (!c.actor_id) continue;
    byActor.set(c.actor_id, [...(byActor.get(c.actor_id) || []), c]);
  }
  for (const [actorId, list] of byActor) {
    const actor = byId.get(actorId)?.name || 'Someone';
    const targets = parents.filter((p) => p.id !== actorId).map((p) => p.id);
    const last = list[list.length - 1];
    const body = list.length === 1
      ? `${actor} ${last.summary}.`
      : `${actor} made ${list.length} changes. Latest: ${last.summary}.`;
    await sendTo(targets, JSON.stringify({ title: 'Loy Family', body, tag: `change-${actorId}` }));
  }
  return json({ sent });
});
