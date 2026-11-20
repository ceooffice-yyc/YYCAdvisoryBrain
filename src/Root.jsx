import { useCallback, useEffect, useId, useState } from 'react'
import App from './App.jsx'

// Decides what to show before the app: with the shared database (Supabase) people must sign in first; without it the app opens directly.
// Sign-in screen: sign in, "Request access" (an admin approves it), "Forgot password?". An invite or reset email leads to "Set your password".
// The look comes from the .auth-* classes and the design tokens in src/index.css (light and dark themes).

const EXPIRED = 'This link has expired or was already used. Ask an administrator for a new invite or a temporary password.'

/* The frame every sign-in screen shares: brand, a real page title, then the content. */
function Shell({ title, sub, children, as: Tag = 'div', onSubmit }) {
  return (
    <main className="auth-page">
      <Tag className="auth-card" onSubmit={onSubmit} noValidate={Tag === 'form' ? true : undefined}>
        <div className="auth-brand">
          <img src="/logo.png" alt="" />
          <div>
            <div className="auth-eyebrow">YYC Advisory Brain</div>
            <h1 className="auth-title">{title}</h1>
          </div>
        </div>
        {sub && <p className="auth-sub">{sub}</p>}
        {children}
      </Tag>
    </main>
  )
}

/* A labelled input: the label is tied to the field, so clicking it focuses the field and screen readers announce it. */
function Field({ label, hint, textarea = false, ...props }) {
  const id = useId()
  const Input = textarea ? 'textarea' : 'input'
  return (
    <>
      <label className="auth-label" htmlFor={id}>{label}</label>
      <Input id={id} className="auth-field" aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && <div className="auth-hint" id={`${id}-hint`}>{hint}</div>}
    </>
  )
}

const ErrorNote = ({ children }) => (children ? <div className="auth-error" role="alert"><span aria-hidden="true">!</span><span>{children}</span></div> : null)
const Primary = ({ busy, children, ...props }) => <button type="submit" className="auth-btn is-primary" disabled={busy} aria-busy={busy || undefined} {...props}>{children}</button>
const Quiet = ({ children, ...props }) => <button type="button" className="auth-btn is-quiet" {...props}>{children}</button>

function Login({ onDone, onGuest, notice, emailInvites }) {
  const [view, setView] = useState('signin') // 'signin' | 'request' | 'forgot' | 'sent'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [password2, setPassword2] = useState('')
  const [err, setErr] = useState(notice || '')
  const [busy, setBusy] = useState(false)
  const [sentText, setSentText] = useState('')
  const go = (v) => { setView(v); setErr(''); setPassword(''); setPassword2('') }

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
    if (!emailInvites) { // no emails are sent, so the password is chosen now
      if (password.length < 10) { setErr('Choose a password of at least 10 characters.'); return }
      if (password !== password2) { setErr('The two passwords do not match.'); return }
    }
    setBusy(true); setErr('')
    try {
      await window.storage.requestAccess(emailInvites ? { name, email, note } : { name, email, note, password })
      setPassword(''); setPassword2('')
      setSentText(emailInvites ? 'Thank you. An administrator will review your request. If it is approved, you will receive an email with a link to set your password.' : 'Thank you. An administrator will review your request. Once it is approved, sign in here with your email and the password you just chose.')
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
      <Shell title={emailInvites ? 'Check your email' : 'Request sent'}>
        <p className="auth-message" role="status">{sentText}</p>
        <div style={{ marginTop: 18 }}><Quiet onClick={() => go('signin')}>Back to sign in</Quiet></div>
      </Shell>
    )
  }
  if (view === 'request') {
    return (
      <Shell as="form" onSubmit={request} title="Request access" sub={emailInvites ? 'An administrator reviews every request. You get an email only if it is approved.' : 'An administrator reviews every request. You can sign in as soon as it is approved.'}>
        <Field label="Full name" autoComplete="name" autoFocus maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setErr('') }} />
        <Field label="Work email" hint="Use your company email address. Other addresses are not accepted." type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
        {!emailInvites && (<>
          <Field label="Choose a password" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setErr('') }} />
          <Field label="Type the password again" type="password" autoComplete="new-password" value={password2} onChange={(e) => { setPassword2(e.target.value); setErr('') }}
            hint="At least 10 characters. You will sign in with it once your request is approved." />
        </>)}
        <Field label="Why do you need access? (optional)" textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorNote>{err}</ErrorNote>
        <Primary busy={busy}>{busy ? 'Sending…' : 'Send request'}</Primary>
        <Quiet onClick={() => go('signin')}>Back to sign in</Quiet>
      </Shell>
    )
  }
  if (view === 'forgot') {
    return (
      <Shell as="form" onSubmit={forgot} title="Reset your password" sub="Enter your email and we will send a link to choose a new password.">
        <Field label="Email" type="email" autoComplete="username" inputMode="email" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
        <ErrorNote>{err}</ErrorNote>
        <Primary busy={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</Primary>
        <Quiet onClick={() => go('signin')}>Back to sign in</Quiet>
      </Shell>
    )
  }
  return (
    <Shell as="form" onSubmit={signIn} title="Sign in" sub="Find strategies and answers from the YYC knowledge base.">
      <Field label="Email" type="email" autoComplete="username" inputMode="email" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
      <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErr('') }} />
      {emailInvites && <div style={{ textAlign: 'right', marginTop: -10 }}><button type="button" className="auth-link" onClick={() => go('forgot')}>Forgot password?</button></div>}
      <ErrorNote>{err}</ErrorNote>
      <Primary busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</Primary>
      <Quiet onClick={() => go('request')}>Request access</Quiet>
      {onGuest && <Quiet onClick={onGuest}>Continue as guest</Quiet>}
      <p className="auth-note">{onGuest ? 'Guests can browse the knowledge base and lever records only. ' : ''}New here? Request access and an administrator will review it.{emailInvites ? '' : ' Forgotten your password? Ask an administrator for a new temporary one.'}</p>
    </Shell>
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
    <Shell as="form" onSubmit={submit} title={kind === 'invite' || kind === 'temp' ? 'Choose your own password' : 'Choose a new password'} sub={kind === 'invite' || kind === 'temp' ? 'Welcome. One last step before you start.' : undefined}>
      <Field label="New password" type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} />
      <Field label="Type it again" type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr('') }}
        hint={`At least 10 characters. A few random words is a good password.${kind === 'temp' ? ' The temporary password stops working once you save.' : ''}`} />
      <ErrorNote>{err}</ErrorNote>
      <Primary busy={busy}>{busy ? 'Saving…' : 'Save and continue'}</Primary>
    </Shell>
  )
}

/* An invite or reset link with a token. The token is only used when the person presses Continue, so software that opens links in emails
   (mail scanners, link previews) cannot use it up first. */
function ConfirmLink({ kind, tokenHash, onVerified, onFailed }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await window.storage.verifyEmailLink(tokenHash, kind); onVerified() }
    catch { onFailed() }
  }
  return (
    <Shell title={kind === 'invite' ? 'You have been invited' : 'Reset your password'}>
      <p className="auth-message">{kind === 'invite' ? 'Press Continue to accept the invitation and choose your password.' : 'Press Continue to choose a new password.'}</p>
      <div style={{ marginTop: 18 }}><Primary busy={busy} type="button" onClick={go}>{busy ? 'Checking…' : 'Continue'}</Primary></div>
    </Shell>
  )
}

function Message({ title, children }) {
  return <Shell title={title}><div className="auth-message" role="status">{children}</div></Shell>
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
    const blocked = (e) => { const m = (e.detail && e.detail.message) || 'Your access has changed. Please sign in again.'; W.signOut().finally(() => toLogin(m)) } // an admin disabled this account while it was open
    window.addEventListener('yyc-auth-blocked', blocked)
    const showLogin = () => toLogin('') // the guest pressed "Log in"
    window.addEventListener('yyc-show-login', showLogin)
    ;(async () => {
      if (boot.tokenHash) { setPwKind(boot.tokenType); setPhase('confirm'); return } // wait for the person to press Continue
      const has = await W.hasSession()
      if (boot.link && has) { setPhase('setpw'); return } // an invite or reset link: choose a password before anything else
      if (!has) {
        if (boot.link || boot.linkError) return toLogin(EXPIRED)
        if (boot.guest && W.isGuest()) { setGuestState(true); setPhase('app'); return }
        return toLogin('')
      }
      try { const me = await W.loadMe(); setUser(me); if (me.mustChangePassword) { setPwKind('temp'); setPhase('setpw') } else setPhase('app') } catch (e) { await W.signOut(); toLogin(String(e.message || '')) }
    })()
    return () => { off(); window.removeEventListener('yyc-auth-expired', expired); window.removeEventListener('yyc-auth-blocked', blocked); window.removeEventListener('yyc-show-login', showLogin) }
  }, [signedIn, boot.guest, boot.link, boot.linkError, boot.tokenHash, boot.tokenType, toLogin])

  // the password is saved: ask the server who this is (it also applies the allowed-domain and disabled-account rules), then open the library
  const afterPassword = async () => {
    try { setUser(await window.storage.loadMe()) } catch (e) { await window.storage.signOut(); toLogin(String(e.message || '')); return }
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
    setPhase('app')
  }

  if (phase === 'error') return <Message title="The site is not set up correctly">{boot.error} Please tell your administrator.</Message>
  if (phase === 'checking') return <Message title="Loading…">Checking your sign-in.</Message>
  if (phase === 'confirm') {
    const clearUrl = () => { try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ } }
    return <ConfirmLink kind={boot.tokenType} tokenHash={boot.tokenHash} onVerified={() => { clearUrl(); setPhase('setpw') }} onFailed={() => { clearUrl(); toLogin(EXPIRED) }} />
  }
  if (phase === 'setpw') return <SetPassword kind={pwKind} onDone={afterPassword} />
  if (phase === 'login') {
    return <Login notice={notice} emailInvites={!!boot.emailInvites} onDone={(u) => { setUser(u); setGuestState(false); setNotice(''); if (u.mustChangePassword) { setPwKind('temp'); setPhase('setpw') } else setPhase('app') }}
      onGuest={boot.guest ? () => { window.storage.setGuest(true); setGuestState(true); setNotice(''); setPhase('app') } : null} />
  }
  return <App key={user ? user.id : guest ? 'guest' : 'local'} />
}
