// Browser tests (npm run e2e). They run the BUILT app on the real Express server, on its own port, with no database and a made-up AI key:
// the app opens in its browser-only mode, so nothing here can reach the shared library or spend AI tokens.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 8791;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0, // a shared CI machine is slower and noisier than a PC: one retry for a timing hiccup (a real bug fails twice)
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  outputDir: 'e2e/.results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome', // the Chrome already installed on this PC: no browser download
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node server/index.js',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    // empty Supabase settings win over the ones in .env, so the test server never talks to the real database
    env: { PORT: String(PORT), HOST: '127.0.0.1', GROQ_API_KEY: 'e2e-not-a-real-key', GROQ_API_KEYS: '', GROQ_API_KEY_2: '', GROQ_API_KEY_3: '', GROQ_API_KEY_4: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', GEMINI_API_KEY: '' },
  },
});
