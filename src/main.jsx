// src/storage-shim.js
if (!window.storage) {
  window.storage = {
    async get(key)        { const v = localStorage.getItem(key); if (v === null) throw new Error("not found"); return { key, value: v }; },
    async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
    async delete(key)     { localStorage.removeItem(key); return { key, deleted: true }; },
    async list(prefix)    { return { keys: Object.keys(localStorage).filter(k => !prefix || k.startsWith(prefix)) }; },
  };
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
