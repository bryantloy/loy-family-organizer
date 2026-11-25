'use client';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_KEY;

export const configured = Boolean(url && key);

export const supabase = configured
  ? createClient(url, key, {
      db: { schema: 'family' },
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'loy-family-auth' },
    })
  : null;
