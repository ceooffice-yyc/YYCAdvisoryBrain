// Shared by the browser tests: an invented little library placed in the browser's own storage (the test server has no database),
// a way to unlock admin in that mode, and a way to show the sign-in screen without a real Supabase project.

const DOCS = [
  { id: 'd1', title: 'Acme Bakery: delivery fees without losing customers', industry: 'Food & Beverage (retail)', industry_main: 'Trading / Retail', industry_sub: 'Bakery', problem: 'Thin margins on home delivery' },
  { id: 'd2', title: 'Northwind Clinics: filling quiet afternoons', industry: 'Healthcare (clinics)', industry_main: 'Services', industry_sub: 'Clinics', problem: 'Idle capacity at off-peak hours' },
  { id: 'd3', title: 'Globex Furniture: a long title that keeps going so the layout has to cope with wrapping on a narrow phone screen', industry: 'Furniture (manufacturing)', industry_main: 'Manufacturing', industry_sub: 'Furniture', problem: 'Cash tied up in stock' },
];
const RECORDS = [
  ['d1', 'price', 'Charge for delivery: The bakery added a small delivery fee and kept its menu prices unchanged.', 'Delivery orders stayed level while margin per order rose.'],
  ['d1', 'volume', 'Morning office bundles: Pre-ordered breakfast boxes for nearby offices, delivered before nine.', 'N/A'],
  ['d1', 'cogs', 'Buy flour on contract: A twelve-month contract with one mill replaced weekly spot buying.', 'Flour cost fell by about a tenth.'],
  ['d2', 'volume', 'Off-peak appointments: Lower prices for mid-afternoon slots, shown clearly when booking.', 'Afternoon bookings rose within a quarter.'],
  ['d2', 'talent_strategy', 'Pair new and senior nurses: Every new nurse works alongside a senior one for the first three months.', 'N/A'],
  ['d2', 'ar_days', 'Collect at the desk: Payment is taken before the patient leaves, not invoiced later.', 'Overdue accounts dropped sharply.'],
  ['d3', 'inventory_days', 'Make to order: Sofas are built after the order is placed, with a clear delivery date.', 'Stock in the warehouse halved.'],
  ['d3', 'others', 'Own the showroom lease: A long lease with a break clause kept the best location.', 'N/A'],
];

export const library = () => {
  const index = DOCS.map((d, i) => ({ id: d.id, status: 'active', title: d.title, doc_type: 'case_study', industry: d.industry, industry_main: d.industry_main, industry_sub: d.industry_sub, language: 'en', problem_signature: d.problem, created: 1760000000000 + i * 86400000 }));
  const docs = DOCS.map((d, i) => ({ ...index[i], sections: [{ heading: 'Pricing', summary_en: 'How the business changed what it charges.' }, { heading: 'Volume', summary_en: 'How it found more customers.' }], full_text: `${d.title}\n\nPricing\n\nInvented text for tests.`, html: `<h1>${d.title}</h1><h2>Pricing</h2><p>Invented text for tests. It is long enough to wrap over more than one line so the reading view can be checked properly.</p><table><tr><th>Lever</th><th>What they did</th></tr><tr><td>Pricing</td><td>Changed what they charge.</td></tr></table>` }));
  const records = RECORDS.map(([doc_id, lever, claim_en, impact], i) => ({ id: `r${i + 1}`, status: 'active', doc_id, doc_title: DOCS.find((d) => d.id === doc_id).title, lever, claim_en, impact, section: 'Pricing', ...(lever === 'others' ? { other_category: 'business_model_execution', related_to: 'location' } : {}) }));
  return { index, docs, records };
};

/* Put the invented library in place before the app starts (only once per browser context). `empty` = a brand-new, empty library. */
export async function seed(page, { empty = false } = {}) {
  await page.addInitScript(({ lib, emptyLib }) => {
    if (localStorage.getItem('kb:config')) return;
    localStorage.setItem('kb:config', JSON.stringify({ adminPass: '12345' }));
    localStorage.setItem('kb:index', JSON.stringify(emptyLib ? [] : lib.index));
    localStorage.setItem('kb:levers', JSON.stringify(emptyLib ? [] : lib.records));
    if (!emptyLib) for (const d of lib.docs) localStorage.setItem('kb:doc:' + d.id, JSON.stringify(d));
  }, { lib: library(), emptyLib: empty });
}

export async function unlockAdmin(page) {
  await page.getByRole('button', { name: 'Unlock admin' }).first().click();
  await page.locator('input[type="password"]').fill('12345');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Exit admin' }).first().waitFor();
}

/* Make the app believe sign-in is switched on, so the sign-in screens can be shown. No real Supabase project is contacted. */
export async function showSignIn(page, { guest = true, emailInvites = false } = {}) {
  await page.route('**/api/db?action=status', (route) => route.fulfill({ json: { mode: 'supabase', url: 'https://example.supabase.co', anonKey: 'test-anon-key', guest, emailInvites } }));
  await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' } }));
}

/* Everything the browser complains about while a test runs. */
export function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

export const SIZES = [
  { name: '320', width: 320, height: 640 },
  { name: '375', width: 375, height: 667 },
  { name: '667-landscape', width: 667, height: 375 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];
