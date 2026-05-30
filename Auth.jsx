import React, { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Auth() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    setMsg(''); setBusy(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Account created. If email confirmation is on, check your inbox, then sign in.')
        setMode('signin')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) {
      setMsg(e.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <div style={{ maxWidth: 360, margin: '0 auto', paddingTop: '14vh' }}>
        <div className="auth-logo">📦</div>
        <h1 className="center" style={{ fontSize: 26, marginBottom: 6 }}>BinStashR</h1>
        <p className="center muted" style={{ marginTop: 0, marginBottom: 28 }}>
          Label, scan, and find everything you store.
        </p>

        <label className="field">Email</label>
        <input type="email" value={email} autoCapitalize="none" autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          style={{ marginBottom: 14 }} />

        <label className="field">Password</label>
        <input type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={{ marginBottom: 18 }} />

        <button className="btn primary" disabled={busy} onClick={submit}
          style={{ marginBottom: 14 }}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        {msg && <p className="center" style={{ fontSize: 13, color: 'var(--brand-text)' }}>{msg}</p>}

        <p className="center muted" style={{ fontSize: 14, marginTop: 18 }}>
          {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
          <button className="btn ghost" style={{ display: 'inline', width: 'auto', padding: '2px 6px', border: 'none', color: 'var(--brand)' }}
            onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg('') }}>
            {mode === 'signup' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}
