'use client';
import { supabase } from '@/lib/supabase.mjs';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Ask the phone for alerts and save this phone's push address. Must run
// from a tap.
export async function turnOnAlerts() {
  if (!pushSupported()) throw new Error("This browser can't show alerts.");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Alerts are blocked for this site in your browser settings.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // The public alert key comes from the family-notify function.
    const { data, error } = await supabase.functions.invoke('family-notify', { body: { action: 'key' } });
    if (error || !data?.publicKey) throw new Error("Alerts aren't set up yet. Try again in a minute.");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) });
  }
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw new Error(error.message);
}

// Stop alerts on this phone for whoever is signed in (used on sign out).
export async function dropAlerts() {
  try {
    const sub = await currentSubscription();
    if (sub) await supabase.rpc('drop_push', { p_endpoint: sub.endpoint });
  } catch {}
}

// After Dad or Mom changes something, ask the notify function to send the
// other parent an alert. It only sends what the database logged, so an
// extra call does nothing.
export function pingOtherParent() {
  supabase.functions.invoke('family-notify', { body: {} }).catch(() => {});
}
