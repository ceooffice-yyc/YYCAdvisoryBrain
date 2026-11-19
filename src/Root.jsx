import { useCallback, useEffect, useState } from 'react'
import App from './App.jsx'

// Decides what to show before the app: with the shared database (Supabase) people must sign in first; without it the app opens directly.
// Sign-in screen: sign in, "Request access" (an admin approves it), "Forgot password?". An invite or reset email leads to "Set your password".
const CRIMSON = '#9A0000'
const card = { width: 380, maxWidth: '100%', background: '#fff', border: '1px solid #e7e2dc', borderRadius: 16, padding: 28, boxShadow: '0 10px 40px rgba(60,20,20,0.10)' }
const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#faf7f4', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#241414' }
const field = { width: '100%', boxSizing: 'border-box', background: '#fff', color: '#241414', padding: '11px 12px', border: '1px solid #d9d2cb', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', outline: 'none' }
const label = { fontSize: 12, fontWeight: 700, color: '#7a6d66' }
const primary = (busy) => ({ width: '100%', marginTop: 18, padding: '12px 14px', border: 0, borderRadius: 10, background: CRIMSON, color: '#fff', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: 'inherit' })
const secondary = { width: '100%', marginTop: 10, padding: '11px 14px', border: '1px solid #d9d2cb', borderRadius: 10, background: '#fff', color: '#4a0707', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const linkBtn = { background: 'none', border: 0, padding: 0, color: CRIMSON, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }
const errStyle = { color: CRIMSON, fontSize: 13, fontWeight: 600, marginTop: 10, lineHeight: 1.5 }

const EXPIRED = 'This link has expired or was already used. Use "Forgot password?" to get a new one, or ask an administrator to send a new invite.'

function Header({ subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
      <img src="/logo.png" alt="YYC" style={{ width: 44, height: 44, objectFit: 'contain' }} />
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#4a0707' }}>YYC Advisory Brain</div>
        <div style={{ fontSize: 12.5, color: '#7a6d66' }}>{subtitle}</div>
      </div>
    </div>
  )
}

function Login({ onDone, onGuest, notice, emailInvites }) {
  const [view, setView] = useState('signin') // 'signin' | 'request' | 'forgot' | 'sent'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState(notice || '')
  const [busy, setBusy] = useState(false)
  const [sentText, setSentText] = useState('')
  const go = (v) => { setView(v); setErr(''); setPassword('') }

  const signIn = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) { setErr('Enter your email and password.'); return }
    setBusy(true); setErr('')
    try { onDone(await window.storage.signIn(email, password)) }
    catch (ex) { setErr(String(ex.message || 'Could not sign in.')); setBusy(false) }
  }
  const request = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) { setErr('Enter your name and work email.'); return }
    setBusy(true); setErr('')
    try {
      await window.storage.requestAccess({ name, email, note })
      setSentText(emailInvites ? 'Thank you. An administrator will review your request. If it is approved, you will receive an email with a link to set your password.' : 'Thank you. An administrator will review your request and contact you if it is approved. They will give you a temporary password, which you change the first time you sign in.')
      setView('sent')
    } catch (ex) { setErr(String(ex.message || 'The request could not be sent.')) }
    setBusy(false)
  }
  const forgot = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setErr('Enter your email.'); return }
    setBusy(true); setErr('')
    try {
      await window.storage.sendReset(email)
      setSentText('If that address has an account, an email with a link to choose a new password is on its way. The link works once and expires after a while.')
      setView('sent')
    } catch (ex) { setErr(String(ex.message || 'Could not send the email.')) }
    setBusy(false)
  }

  if (view === 'sent') {
    return (
      <div style={page}>
        <div style={card}>
          <Header subtitle="Check your email" />
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>{sentText}</div>
          <button type="button" style={secondary} onClick={() => go('signin')}>Back to sign in</button>
        </div>
      </div>
    )
  }
  if (view === 'request') {
    return (
      <div style={page}>
        <form onSubmit={request} style={card}>
          <Header subtitle="Request access" />
          <label style={label}>Full name</label>
          <input style={{ ...field, margin: '5px 0 14px' }} autoComplete="name" autoFocus maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setErr('') }} />
          <label style={label}>Work email</label>
          <input style={{ ...field, margin: '5px 0 14px' }} type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
          <label style={label}>Why do you need access? (optional)</label>
          <textarea style={{ ...field, margin: '5px 0 6px', minHeight: 70, resize: 'none' }} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <div style={errStyle}>{err}</div>}
          <button type="submit" disabled={busy} style={primary(busy)}>{busy ? 'Sending…' : 'Send request'}</button>
          <button type="button" style={secondary} onClick={() => go('signin')}>Back to sign in</button>
          <div style={{ fontSize: 12, color: '#7a6d66', marginTop: 14, lineHeight: 1.55 }}>{emailInvites ? 'An administrator reviews every request. You get an email only if it is approved.' : 'An administrator reviews every request and will contact you if it is approved.'}</div>
        </form>
      </div>
    )
  }
  if (view === 'forgot') {
    return (
      <div style={page}>
        <form onSubmit={forgot} style={card}>
          <Header subtitle="Reset your password" />
          <label style={label}>Email</label>
          <input style={{ ...field, margin: '5px 0 6px' }} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
          {err && <div style={errStyle}>{err}</div>}
          <button type="submit" disabled={busy} style={primary(busy)}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
          <button type="button" style={secondary} onClick={() => go('signin')}>Back to sign in</button>
        </form>
      </div>
    )
  }
  return (
    <div style={page}>
      <form onSubmit={signIn} style={card}>
        <Header subtitle="Sign in to continue" />
        <label style={label}>Email</label>
        <input style={{ ...field, margin: '5px 0 14px' }} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
        <label style={label}>Password</label>
        <input style={{ ...field, margin: '5px 0 6px' }} type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErr('') }} />
        {emailInvites ? <div style={{ textAlign: 'right' }}><button type="button" style={linkBtn} onClick={() => go('forgot')}>Forgot password?</button></div> : <div style={{ height: 4 }} />}
        {err && <div style={errStyle}>{err}</div>}
        <button type="submit" disabled={busy} style={primary(busy)}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" onClick={() => go('request')} style={secondary}>Request access</button>
        {onGuest && <button type="button" onClick={onGuest} style={secondary}>Continue as guest</button>}
        <div style={{ fontSize: 12, color: '#7a6d66', marginTop: 14, lineHeight: 1.55 }}>{onGuest ? 'Guests can browse the knowledge base and lever records only. ' : ''}New here? Request access and an administrator will review it.{emailInvites ? '' : ' Forgotten your password? Ask an administrator for a new temporary one.'}</div>
      </form>
    </div>
  )
}

/* After an invite or reset link: choose the password to use from now on. */
function SetPassword({ kind, onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 10) { setErr('Use at least 10 characters.'); return }
    if (pw !== pw2) { setErr('The two passwords do not match.'); return }
    setBusy(true); setErr('')
    try { await (kind === 'temp' ? window.storage.changePassword(pw) : window.storage.setPassword(pw)); await onDone() }
    catch (ex) { setErr(String(ex.message || 'Could not save the password.')); setBusy(false) }
  }
  return (
    <div style={page}>
      <form onSubmit={submit} style={card}>
        <Header subtitle={kind === 'invite' || kind === 'temp' ? 'Welcome. Choose your own password' : 'Choose a new password'} />
        <label style={label}>New password</label>
        <input style={{ ...field, margin: '5px 0 14px' }} type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} />
        <label style={label}>Type it again</label>
        <input style={{ ...field, margin: '5px 0 6px' }} type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr('') }} />
        <div style={{ fontSize: 12, color: '#7a6d66', marginTop: 8, lineHeight: 1.5 }}>At least 10 characters. A few random words is a good password.{kind === 'temp' ? ' The temporary password stops working once you save.' : ''}</div>
        {err && <div style={errStyle}>{err}</div>}
        <button type="submit" disabled={busy} style={primary(busy)}>{busy ? 'Saving…' : 'Save and continue'}</button>
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
  const [pwKind, setPwKind] = useState(boot.link || null) // 'invite' | 'recovery' (an emailed link) | 'temp' (signed in with a temporary password)

  const toLogin = useCallback((msg) => { setUser(null); setGuestState(false); window.storage.setGuest(false); setNotice(msg || ''); setPhase('login') }, [])

  useEffect(() => {
    if (!signedIn) return undefined
    const W = window.storage
    let off = W.onSignedOut(() => toLogin(''))
    const expired = () => { W.signOut().finally(() => toLogin('Your session has ended. Please sign in again.')) }
    window.addEventListener('yyc-auth-expired', expired)
    const showLogin = () => toLogin('') // the guest pressed "Log in"
    window.addEventListener('yyc-show-login', showLogin)
    ;(async () => {
      const has = await W.hasSession()
      if (boot.link && has) { setPhase('setpw'); return } // an invite or reset link: choose a password before anything else
      if (!has) {
        if (boot.link || boot.linkError) return toLogin(EXPIRED)
        if (boot.guest && W.isGuest()) { setGuestState(true); setPhase('app'); return }
        return toLogin('')
      }
      try { const me = await W.loadMe(); setUser(me); if (me.mustChangePassword) { setPwKind('temp'); setPhase('setpw') } else setPhase('app') } catch (e) { await W.signOut(); toLogin(String(e.message || '')) }
    })()
    return () => { off(); window.removeEventListener('yyc-auth-expired', expired); window.removeEventListener('yyc-show-login', showLogin) }
  }, [signedIn, boot.guest, boot.link, boot.linkError, toLogin])

  // the password is saved: ask the server who this is (it also applies the allowed-domain and disabled-account rules), then open the library
  const afterPassword = async () => {
    try { setUser(await window.storage.loadMe()) } catch (e) { await window.storage.signOut(); toLogin(String(e.message || '')); return }
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
    setPhase('app')
  }

  if (phase === 'error') return <Message><b>The server is not set up correctly.</b><br />{boot.error}</Message>
  if (phase === 'checking') return <Message>Loading…</Message>
  if (phase === 'setpw') return <SetPassword kind={pwKind} onDone={afterPassword} />
  if (phase === 'login') {
    return <Login notice={notice} emailInvites={!!boot.emailInvites} onDone={(u) => { setUser(u); setGuestState(false); setNotice(''); if (u.mustChangePassword) { setPwKind('temp'); setPhase('setpw') } else setPhase('app') }}
      onGuest={boot.guest ? () => { window.storage.setGuest(true); setGuestState(true); setNotice(''); setPhase('app') } : null} />
  }
  return <App key={user ? user.id : guest ? 'guest' : 'local'} />
}
