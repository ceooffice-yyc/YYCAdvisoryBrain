import { useEffect, useState } from 'react'
import App from './App.jsx'

// Decides what to show before the app: with the shared database (Supabase) people must sign in first; without it the app opens directly.
const CRIMSON = '#9A0000'
const card = { width: 380, maxWidth: '100%', background: '#fff', border: '1px solid #e7e2dc', borderRadius: 16, padding: 28, boxShadow: '0 10px 40px rgba(60,20,20,0.10)' }
const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#faf7f4', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#241414' }
const field = { width: '100%', boxSizing: 'border-box', background: '#fff', color: '#241414', padding: '11px 12px', border: '1px solid #d9d2cb', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', outline: 'none' }

function Login({ onDone, onGuest, notice }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(notice || '')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) { setErr('Enter your email and password.'); return }
    setBusy(true); setErr('')
    try { onDone(await window.storage.signIn(email, password)) }
    catch (ex) { setErr(String(ex.message || 'Could not sign in.')); setBusy(false) }
  }
  return (
    <div style={page}>
      <form onSubmit={submit} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <img src="/logo.png" alt="YYC" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#4a0707' }}>YYC Advisory Brain</div>
            <div style={{ fontSize: 12.5, color: '#7a6d66' }}>Sign in to continue</div>
          </div>
        </div>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#7a6d66' }}>Email</label>
        <input style={{ ...field, margin: '5px 0 14px' }} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
        <label style={{ fontSize: 12, fontWeight: 700, color: '#7a6d66' }}>Password</label>
        <input style={{ ...field, margin: '5px 0 6px' }} type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErr('') }} />
        {err && <div style={{ color: CRIMSON, fontSize: 13, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 18, padding: '12px 14px', border: 0, borderRadius: 10, background: CRIMSON, color: '#fff', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: 'inherit' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {onGuest && (
          <button type="button" onClick={onGuest} style={{ width: '100%', marginTop: 10, padding: '11px 14px', border: '1px solid #d9d2cb', borderRadius: 10, background: '#fff', color: '#4a0707', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Continue as guest
          </button>
        )}
        <div style={{ fontSize: 12, color: '#7a6d66', marginTop: 14, lineHeight: 1.55 }}>{onGuest ? 'Guests can browse the knowledge base and lever records only. ' : ''}Accounts are created by your administrator. Forgotten your password? Ask them to reset it.</div>
      </form>
    </div>
  )
}

function Message({ children }) {
  return <div style={page}><div style={{ ...card, fontSize: 14, lineHeight: 1.6 }}>{children}</div></div>
}

export default function Root({ boot }) {
  const signedIn = boot.mode === 'supabase'
  const [phase, setPhase] = useState(boot.mode === 'error' ? 'error' : signedIn ? 'checking' : 'app')
  const [guest, setGuestState] = useState(false)
  const [user, setUser] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!signedIn) return undefined
    const W = window.storage
    const toLogin = (msg) => { setUser(null); setGuestState(false); W.setGuest(false); setNotice(msg || ''); setPhase('login') }
    let off = W.onSignedOut(() => toLogin(''))
    const expired = () => { W.signOut().finally(() => toLogin('Your session has ended. Please sign in again.')) }
    window.addEventListener('yyc-auth-expired', expired)
    const showLogin = () => toLogin('') // the guest pressed "Log in"
    window.addEventListener('yyc-show-login', showLogin)
    ;(async () => {
      if (!(await W.hasSession())) {
        if (boot.guest && W.isGuest()) { setGuestState(true); setPhase('app'); return }
        return toLogin('')
      }
      try { setUser(await W.loadMe()); setPhase('app') } catch (e) { await W.signOut(); toLogin(String(e.message || '')) }
    })()
    return () => { off(); window.removeEventListener('yyc-auth-expired', expired); window.removeEventListener('yyc-show-login', showLogin) }
  }, [signedIn, boot.guest])

  if (phase === 'error') return <Message><b>The server is not set up correctly.</b><br />{boot.error}</Message>
  if (phase === 'checking') return <Message>Loading…</Message>
  if (phase === 'login') {
    return <Login notice={notice} onDone={(u) => { setUser(u); setGuestState(false); setNotice(''); setPhase('app') }}
      onGuest={boot.guest ? () => { window.storage.setGuest(true); setGuestState(true); setNotice(''); setPhase('app') } : null} />
  }
  return <App key={user ? user.id : guest ? 'guest' : 'local'} />
}
