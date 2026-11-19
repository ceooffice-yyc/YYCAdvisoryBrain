import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Boot from './Boot.jsx'
import { initStorage } from './storage.js'

// window.storage is either the shared online database (Supabase, with sign-in) or this browser's localStorage; see src/storage.js
// The page is drawn at once with a loading message; the sign-in check runs while it is on screen, and the Knowledge Base code downloads at the same time.
const booting = initStorage()
import('./screens/KnowledgePanel.jsx').catch(() => { /* the screen asks again when it is needed */ })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Boot booting={booting} />
  </StrictMode>,
)
