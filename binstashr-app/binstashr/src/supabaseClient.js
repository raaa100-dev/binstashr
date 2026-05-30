import { createClient } from '@supabase/supabase-js'

// These come from your .env file (see .env.example and the SETUP guide).
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    'Missing Supabase config. Copy .env.example to .env and fill in your project URL and anon key.'
  )
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'public-anon-key')
