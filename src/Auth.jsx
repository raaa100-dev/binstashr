import React, { useState } from 'react'
import { supabase } from './supabaseClient'
import { COMPANY_NAME } from './config'
import { TermsText, PrivacyText } from './LegalText'

export default function Auth() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    if (mode === 'signup' && !agreed) {
      setMsg('Please agree to the Terms and Privacy Policy to create an account.')
      return
    }
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

  if (showTerms) return <LegalModal title="Terms of Service" body={<TermsText />} onClose={() => setShowTerms(false)} />
  if (showPrivacy) return <LegalModal title="Privacy Policy" body={<PrivacyText />} onClose={() => setShowPrivacy(false)} />

  return (
    <div className="app">
      <div style={{ maxWidth: 360, margin: '0 auto', paddingTop: '12vh' }}>
        <div className="auth-logo">📦</div>
        <h1 className="center" style={{ fontSize: 26, marginBottom: 6 }}>{COMPANY_NAME}</h1>
        <p className="center muted" style={{ marginTop: 0, marginBottom: 28 }}>
          Label, scan, and find everything you store.
        </p>

        <label className="field">Email</label>
        <input type="email" value={email} autoCapitalize="none" autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          style={{ marginBottom: 14 }} />

        <label className="field">Password</label>
        <input type="password" value={password} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
          onKeyDown={(e) => e.key === 'Enter' && submit()} style={{ marginBottom: 14 }} />

        {mode === 'signup' && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16, fontSize: 13, lineHeight: 1.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 'auto', marginTop: 3, flexShrink: 0 }} />
            <span>
              I agree to the{' '}
              <button onClick={(e) => { e.preventDefault(); setShowTerms(true) }} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Terms of Service</button>
              {' '}and{' '}
              <button onClick={(e) => { e.preventDefault(); setShowPrivacy(true) }} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Privacy Policy</button>.
            </span>
          </label>
        )}

        <button className="btn primary" disabled={busy} onClick={submit}
          style={{ marginBottom: 14 }}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        {msg && <p className="center" style={{ fontSize: 13, color: 'var(--brand-text)' }}>{msg}</p>}

        <p className="center muted" style={{ fontSize: 14, marginTop: 18 }}>
          {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
          <button style={{ background: 'none', border: 'none', padding: '2px 6px', color: 'var(--brand)', cursor: 'pointer', font: 'inherit' }}
            onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg('') }}>
            {mode === 'signup' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}

function LegalModal({ title, body, onClose }) {
  return (
    <div className="app">
      <div className="topbar">
        <button className="iconbtn" aria-label="Back" onClick={onClose}>‹</button>
        <h1 style={{ fontSize: 18 }}>{title}</h1>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, paddingBottom: 20 }}>{body}</div>
      <button className="btn primary" onClick={onClose}>Done</button>
    </div>
  )
}
