import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { COMPANY_NAME } from './config'
import { TermsText, PrivacyText } from './LegalText'

// "mode" can be: 'signin' | 'signup' | 'forgot' | 'reset'
// 'reset' is what we render when the user lands here from a password-reset email link.

export default function Auth() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // If the user just landed via a password reset email link, Supabase will fire
  // an auth event; in that flow we want them to set a new password.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('reset')
    })
    return () => data?.subscription?.unsubscribe?.()
  }, [])

  async function submit() {
    setMsg(''); setBusy(true)
    try {
      if (mode === 'signup') {
        if (!agreed) { setMsg('Please agree to the Terms and Privacy Policy to create an account.'); return }
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Account created. If email confirmation is on, check your inbox, then sign in.')
        setMode('signin')
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'forgot') {
        if (!email.trim()) { setMsg('Enter the email on your account.'); return }
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setMsg("If that email has an account, we sent a reset link. Check your inbox (and spam).")
      } else if (mode === 'reset') {
        if (!password || password.length < 6) { setMsg('Pick a password at least 6 characters.'); return }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        setMsg('Password updated. Redirecting…')
        // User is already signed in via the recovery session.
      }
    } catch (e) {
      setMsg(e.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (showTerms) return <LegalModal title="Terms of Service" body={<TermsText />} onClose={() => setShowTerms(false)} />
  if (showPrivacy) return <LegalModal title="Privacy Policy" body={<PrivacyText />} onClose={() => setShowPrivacy(false)} />

  const titles = {
    signin: 'Sign in',
    signup: 'Create account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  }
  const submitLabels = {
    signin: 'Sign in',
    signup: 'Create account',
    forgot: 'Send reset link',
    reset: 'Save new password',
  }

  return (
    <div className="app">
      <div style={{ maxWidth: 360, margin: '0 auto', paddingTop: '12vh' }}>
        <div className="auth-logo">📦</div>
        <h1 className="center" style={{ fontSize: 26, marginBottom: 6 }}>{COMPANY_NAME}</h1>
        <p className="center muted" style={{ marginTop: 0, marginBottom: 28 }}>
          {mode === 'forgot' ? "We'll email you a link to set a new password." :
           mode === 'reset' ? 'Almost there — enter a new password.' :
           'Label, scan, and find everything you store.'}
        </p>

        {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
          <>
            <label className="field">Email</label>
            <input type="email" value={email} autoCapitalize="none" autoComplete="email"
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              style={{ marginBottom: 14 }} />
          </>
        )}

        {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
          <>
            <label className="field">{mode === 'reset' ? 'New password' : 'Password'}</label>
            <input type="password" value={password} autoComplete={mode === 'signup' || mode === 'reset' ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && submit()} style={{ marginBottom: 14 }} />
          </>
        )}

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
          {busy ? 'Please wait…' : submitLabels[mode]}
        </button>

        {msg && <p className="center" style={{ fontSize: 13, color: 'var(--brand-text)' }}>{msg}</p>}

        {mode === 'signin' && (
          <p className="center" style={{ fontSize: 13, marginTop: 8 }}>
            <button style={{ background: 'none', border: 'none', padding: '2px 6px', color: 'var(--brand)', cursor: 'pointer', font: 'inherit' }}
              onClick={() => { setMode('forgot'); setMsg(''); setPassword('') }}>
              Forgot password?
            </button>
          </p>
        )}

        {(mode === 'signin' || mode === 'signup') && (
          <p className="center muted" style={{ fontSize: 14, marginTop: 18 }}>
            {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
            <button style={{ background: 'none', border: 'none', padding: '2px 6px', color: 'var(--brand)', cursor: 'pointer', font: 'inherit' }}
              onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg('') }}>
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>
        )}

        {mode === 'forgot' && (
          <p className="center muted" style={{ fontSize: 14, marginTop: 18 }}>
            <button style={{ background: 'none', border: 'none', padding: '2px 6px', color: 'var(--brand)', cursor: 'pointer', font: 'inherit' }}
              onClick={() => { setMode('signin'); setMsg('') }}>
              ← Back to sign in
            </button>
          </p>
        )}
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
