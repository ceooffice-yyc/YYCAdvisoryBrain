// The first thing on screen: a loading message (the same one index.html shows before any script arrives) until the sign-in check has finished.
import { useEffect, useState } from 'react'
import Root from './Root.jsx'

export default function Boot({ booting }) {
  const [boot, setBoot] = useState(null)
  useEffect(() => { let on = true; booting.then((b) => { if (on) setBoot(b) }); return () => { on = false } }, [booting])
  if (!boot) return <div className="boot" role="status"><img src="/logo.png" alt="" width="56" height="56" /><p>Loading YYC Advisory Brain…</p></div>
  return <Root boot={boot} />
}
