import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // dev-only: forwards /api calls to the local Express proxy (npm run server)
    // so the browser never talks to Groq, or holds the API key, directly
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
