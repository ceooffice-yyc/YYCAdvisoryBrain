import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'
import { initStorage } from './storage.js'

// window.storage is either the shared online database (Supabase, with sign-in) or this browser's localStorage; see src/storage.js
initStorage().then((boot) => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Root boot={boot} />
    </StrictMode>,
  )
})
