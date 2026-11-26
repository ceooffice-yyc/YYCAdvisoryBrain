# Staging tests (real Supabase)

The normal tests (`npm test`, `npm run e2e`) use an in-memory stand-in for Supabase, so they are fast and free but cannot prove the stand-in behaves like the real service.
`npm run test:staging` runs the same server code against a **real Supabase project made only for testing**, for the two features where that matters most:

| Test | What it proves on the real service |
|---|---|
| Role change | viewer -> admin works on the very next request with the same login; admin -> viewer is refused at once; the 60-second login memory does not hide a change |
| Disable / enable | a disabled account's old login stops working at once and works again when enabled |
| Recently deleted | a deleted material is listed, restores with exactly its strategies, restoring twice does nothing, a strategy deleted on its own restores only when its material is alive (409 otherwise) |
| Activity trail | role, disable, enable, delete and restore entries carry the admin's name, id and a real date |

## One-time setup
1. Create a **separate** Supabase project (not the live one). Run `supabase/schema.sql` in its SQL editor.
2. From Project Settings -> API copy the project URL, the `anon` key and the `service_role` key.
3. Local run (PowerShell):
   ```
   $env:STAGING_SUPABASE_URL = "https://<ref>.supabase.co"
   $env:STAGING_SUPABASE_ANON_KEY = "<anon key>"
   $env:STAGING_SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
   $env:STAGING_CONFIRM = "this-is-not-production"
   npm run test:staging
   ```
4. Nightly run on GitHub: add the same three values as repository secrets named `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`. The workflow is `.github/workflows/staging.yml` (nightly at 04:00 Malaysia time, or "Run workflow" by hand).

## Safety
- Without all four settings every test is **skipped**, so it can never run by accident (and `npm test` never includes it).
- It refuses to run if `STAGING_SUPABASE_URL` equals `SUPABASE_URL` (the live project) when both are set. It cannot detect a live URL that is only in the staging variable, so use a separate project and never copy the live keys.
- It creates two made-up accounts and one made-up material named `staging-<run id>-...` and removes them at the end, also when a test fails. Nothing else is touched.
- The service-role key can do anything in its project: keep it in GitHub secrets only, never in the repository, a screenshot or a chat.
- Search indexing runs with no AI key in this test, so no AI tokens are spent.
