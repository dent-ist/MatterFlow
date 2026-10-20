// Review seeder: node seed-extra.mjs <api> types <targetTotal> | matters <n> | users
import { GROUPS, LONG_TYPES } from './types.mjs';
import fs from 'node:fs';

const API = process.argv[2];
const cmd = process.argv[3];
const arg = Number(process.argv[4] ?? 0);
const H = { 'X-Dev-User': 'ke\\kekim', 'X-MatterFlow-Client': 'web', 'Content-Type': 'application/json' };
async function call(method, path, body, user) {
  const headers = { ...H, ...(user ? { 'X-Dev-User': user } : {}) };
  for (let i = 0; i < 4; i++) {
    const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (r.status === 409 || r.status === 500 || r.status === 429) { await new Promise((s) => setTimeout(s, 600 * (i + 1))); continue; }
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 300)}`);
    return j;
  }
  throw new Error(`${method} ${path} kept failing`);
}
const get = (p, u) => call('GET', p, undefined, u);
const post = (p, b, u) => call('POST', p, b ?? {}, u);
const put = (p, b, u) => call('PUT', p, b, u);

const catalogSrc = fs.readFileSync(new URL('../../../../frontend/src/app/shared/icons/task-type-icon-catalog.generated.ts', import.meta.url), 'utf8');
const icons = [...catalogSrc.matchAll(/key: "([^"]+)", label: "[^"]+", category: "([^"]+)"/g)].map((m) => ({ key: m[1], cat: m[2] }));
const iconFor = (group, i) => {
  const same = icons.filter((x) => x.cat === (group === 'Data & systems' ? 'Data & systems' : group));
  const pool = same.length ? same : icons;
  return pool[i % pool.length].key;
};

async function publishForm(formId, fields) {
  const draft = await post(`/api/v1/forms/${formId}/versions`);
  const saved = await put(`/api/v1/forms/${formId}/versions/${draft.version.formVersionId}`, { fields, rowVersion: draft.version.rowVersion });
  return post(`/api/v1/forms/${formId}/versions/${saved.version.formVersionId}/publish?rowVersion=${encodeURIComponent(saved.version.rowVersion)}`);
}
const baseFields = (n) => {
  const f = [
    { key: 'custodians', label: 'Custodians', control: 'TEXTAREA', required: false },
    { key: 'date_range', label: 'Date range', control: 'TEXT', required: false },
    { key: 'volume_gb', label: 'Estimated volume (GB)', control: 'NUMBER', required: false },
    { key: 'rush', label: 'Rush request', control: 'CHECKBOX', required: false },
  ];
  return f.slice(0, n);
};
const bigFields = () =>
  Array.from({ length: 44 }, (_, i) => ({
    key: `f${i + 1}`,
    label: i % 5 === 0 ? `Question ${i + 1}: describe in as much detail as is known today the systems, owners and retention rules that apply to this data source` : `Detail ${i + 1}`,
    control: i % 7 === 0 ? 'TEXTAREA' : 'TEXT',
    required: i < 6,
    helpText: i % 9 === 0 ? 'Answer in one or two sentences. Say "unknown" if nobody knows yet.' : null,
  }));

if (cmd === 'types') {
  const workflows = (await get('/api/v1/workflows/published')).slice(0, 3);
  const wfIds = workflows.map((w) => w.workflowDefinitionId);
  console.log('published workflows', workflows.map((w) => w.name));
  let existing = await get('/api/v1/task-types');
  const names = new Set(existing.map((t) => t.name));
  let usable = existing.filter((t) => t.isActive && t.isUsable).length;
  console.log('usable now', usable, 'target', arg);
  const list = [];
  let gi = 0;
  for (const [g, items] of Object.entries(GROUPS)) items.forEach(([n, d], i) => list.push({ g, n, d, i }));
  // interleave groups so that the first N added cover all phases
  const byGroup = Object.entries(GROUPS).map(([g, items]) => items.map(([n, d], i) => ({ g, n, d, i })));
  const mixed = [];
  for (let k = 0; mixed.length < list.length; k++) for (const gr of byGroup) if (gr[k]) mixed.push(gr[k]);
  const extra = LONG_TYPES.map(([n, d]) => ({ g: 'Data & systems', n, d, i: 3, big: n.startsWith('Cross') }));
  const variants = list.filter((_, i) => i % 2 === 0).slice(0, 40).map((x) => ({ ...x, n: `${x.n} (Rush)`, d: `${x.d} Same-day turnaround.` }));
  const queue = [...mixed.slice(0, 40), ...extra, ...mixed.slice(40), ...variants];
  for (const t of queue) {
    if (usable >= arg) break;
    if (names.has(t.n)) continue;
    const created = await post('/api/v1/task-types', {
      name: t.n, description: t.d, iconKey: iconFor(t.g, t.i), isActive: true,
      eligibleWorkflowIds: wfIds.slice(0, 1 + (t.i % 2)), defaultWorkflowDefinitionId: wfIds[0],
    });
    await publishForm(created.formDefinitionId, t.big ? bigFields() : baseFields(1 + (t.i % 4)));
    names.add(t.n); usable++;
  }
  console.log('usable after', usable);
} else if (cmd === 'matters') {
  const clients = (await get('/api/v1/clients?pageSize=100')).items;
  console.log('clients', clients.length);
  const long = 'Smith & Wesson Holdings Corporation et al. v. Consolidated Northern Regional Transportation Authority, Inc. and Its Subsidiaries (Class Action, Consolidated Cases 1:24-cv-01234 through 1:24-cv-01299, Second Amended Complaint)';
  const stems = ['Merger Review', 'Patent Infringement', 'Wage and Hour Class Action', 'SEC Subpoena Response', 'Antitrust Second Request', 'Product Liability MDL', 'Internal Investigation', 'Trade Secret Dispute', 'Securities Class Action', 'FCPA Review', 'Data Breach Response', 'Environmental Claim'];
  let made = 0, n = 0;
  const have = await get('/api/v1/matters?pageSize=1');
  console.log('matters before', have.total ?? have.totalCount);
  outer: for (let round = 0; ; round++) {
    for (const c of clients) {
      if (made >= arg) break outer;
      n++;
      const num = String(30000 + round * 100 + (c.clientId % 90)).padStart(5, '0');
      const name = made === 3 ? long : `${stems[made % stems.length]} ${['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega', 'Zenith'][round % 6]} ${made}`;
      try {
        await post('/api/v1/matters', { clientId: c.clientId, matterNumber: num, name, isSensitive: made % 17 === 0 });
        made++;
      } catch (e) { if (!/409|DUPLICATE|exists/i.test(String(e))) console.log(String(e).slice(0, 160)); }
    }
  }
  console.log('matters made', made);
} else if (cmd === 'clients') {
  for (let i = 0; i < arg; i++) {
    const num = String(70000 + i).padStart(5, '0');
    try { await post('/api/v1/clients', { clientNumber: num, name: i === 2 ? 'Meridian Pharmaceuticals International Holdings, Incorporated and its Subsidiaries (Americas Division)' : `Review Client ${i + 1} ${['Industries', 'Capital', 'Health', 'Energy', 'Logistics'][i % 5]}` }); } catch (e) { console.log(String(e).slice(0, 120)); }
  }
}
