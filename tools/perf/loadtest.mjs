#!/usr/bin/env node
// MatterFlow load test: N concurrent virtual users, each signed in as a seeded persona user (Dev auth, X-Dev-User), for D seconds.
// No dependencies (Node 22 fetch). Usage:
//   node loadtest.mjs --base http://127.0.0.1:5911 --vus 50 --duration 60 [--warmup 10] [--think 400-1600] [--out result.json] [--only scenario,scenario]
//
// A virtual user loops: pick a scenario by its persona's weights, run it, think for a random pause, repeat. Latency is measured per HTTP request
// (a scenario that makes several calls records each under its own name; "task_page" records the wall time of the four parallel calls the
// Task detail page makes). Reported per scenario: count, errors (non-2xx/3xx or network), p50/p95/p99/max in ms, requests per second.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : [])),
);
const BASE = args.base ?? 'http://127.0.0.1:5911';
const VUS = Number(args.vus ?? 50);
const DURATION = Number(args.duration ?? 60) * 1000;
const WARMUP = Number(args.warmup ?? 10) * 1000;
const [THINK_MIN, THINK_MAX] = (args.think ?? '400-1600').split('-').map(Number);
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const OUT = args.out;

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userName = (i) => `perf.user${String(i).padStart(3, '0')}`;

// ---------------------------------------------------------------- reference data (sampled through the API as the admin)
const admin = { 'X-Dev-User': 'perf.admin', 'X-MatterFlow-Client': 'web' };
async function getJson(path, headers = admin) {
  const r = await fetch(BASE + path, { headers });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const ref = { taskIds: [], taskNumbers: [], words: [], matterIds: [], clientNumbers: [], matterRefs: [], podIds: [], hotTaskIds: [1, 2, 3, 4, 5], activeMatterIds: [], typeIds: [], clientIds: [], projectIds: [] };
async function loadReferenceData() {
  for (let page = 1; page <= 12; page++) {
    const q = await getJson(`/api/v1/task-queue?pageSize=100&page=${page * 7}`);
    for (const t of q.items) {
      ref.taskIds.push(t.taskId);
      ref.taskNumbers.push(t.taskNumber);
      ref.matterIds.push(t.matterId);
      ref.matterRefs.push(t.matterRef);
      ref.words.push(...t.title.split(' ').filter((w) => /^[A-Za-z]{5,}$/.test(w)), ...t.requestorName.split(' '));
      if (t.projectId) ref.projectIds.push(t.projectId);
      ref.typeIds.push(t.taskTypeId);
      ref.clientIds.push(t.clientId);
    }
  }
  const pods = await getJson('/api/v1/pods');
  ref.podIds = (pods.items ?? pods).map((p) => p.podId ?? p.id).filter(Boolean);
  // only active Matters accept new Tasks
  for (let page = 1; page <= 4; page++) {
    const m = await getJson(`/api/v1/matters?pageSize=100&page=${page}&isActive=true`);
    ref.activeMatterIds.push(...m.items.filter((x) => x.isActive).map((x) => x.matterId));
  }
  ref.clientNumbers = [...new Set(ref.matterRefs.map((r) => r.slice(0, 5)))];
  ref.words = [...new Set(ref.words)];
  ref.matterIds = [...new Set(ref.matterIds)];
  ref.typeIds = [...new Set(ref.typeIds)];
  ref.clientIds = [...new Set(ref.clientIds)];
  ref.projectIds = [...new Set(ref.projectIds)];
}

// ---------------------------------------------------------------- metrics
const stats = new Map(); // name -> { ms: number[], errors, statuses }
let recording = false;
let recordStart = 0;
function record(name, ms, status) {
  if (!recording) return;
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { ms: [], errors: 0, statuses: {} }));
  s.ms.push(ms);
  s.statuses[status] = (s.statuses[status] ?? 0) + 1;
  if (!(status >= 200 && status < 400)) s.errors++;
}

async function call(vu, name, method, path, body) {
  const headers = { 'X-Dev-User': vu.user, 'X-MatterFlow-Client': 'web', 'X-Time-Zone': 'America/New_York' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t0 = performance.now();
  let status = 0;
  let json = null;
  try {
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    status = res.status;
    const text = await res.text();
    if (status < 300 && text.length > 0 && text[0] === '{') json = JSON.parse(text);
    else if (status >= 400 && process.env.LT_DEBUG) console.error(name, status, path, text.slice(0, 300));
  } catch (e) {
    status = 599;
    if (process.env.LT_DEBUG) console.error(name, 'network error', e.message);
  }
  record(name, performance.now() - t0, status);
  return { status, json };
}

// ---------------------------------------------------------------- scenarios
const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => iso(new Date(today.getTime() + n * 86400000));
const prefix = (w) => w.slice(0, 3 + rnd(Math.max(1, Math.min(4, w.length - 3))));

const scenarios = {
  queue_default: (vu) => call(vu, 'queue_default', 'GET', `/api/v1/task-queue?${OPEN}&pageSize=25`),
  queue_filtered: (vu) => {
    const variants = [
      () => `priority=1&priority=2&${OPEN}&pageSize=25`,
      () => `pod=${pick(ref.podIds)}&${OPEN}&pageSize=25`,
      () => `overdue=true&pageSize=25`,
      () => `matter=${pick(ref.matterIds)}&pageSize=25`,
      () => `type=${pick(ref.typeIds)}&${OPEN}&pageSize=25`,
      () => `dueFrom=${daysFromNow(0)}&dueTo=${daysFromNow(14)}&${OPEN}&pageSize=25`,
      () => `q=${encodeURIComponent(pick(ref.words))}&pageSize=25`,
      () => `assignee=${2 + rnd(299)}&${OPEN}&pageSize=25`,
      () => `client=${pick(ref.clientIds)}&pageSize=25`,
      () => `requestor=${encodeURIComponent(pick(ref.words))}&pageSize=25`,
    ];
    return call(vu, 'queue_filtered', 'GET', `/api/v1/task-queue?${pick(variants)()}`);
  },
  queue_sorted: (vu) =>
    call(vu, 'queue_sorted', 'GET', `/api/v1/task-queue?sort=${pick(['due', 'created', 'number', 'priority', 'status'])}&dir=${pick(['asc', 'desc'])}&page=${1 + rnd(5)}&pageSize=${pick([25, 50, 100])}`),
  my_work: (vu) => call(vu, 'my_work', 'GET', `/api/v1/my-work?view=${pick(['active', 'active', 'active', 'dueSoon', 'completed', 'createdByMe'])}&pageSize=25`),
  pod_work: (vu) => call(vu, 'pod_work', 'GET', `/api/v1/pod-work?view=${pick(['queue', 'queue', 'members', 'attention', 'all'])}&pageSize=25`),
  dashboard: (vu) => call(vu, 'dashboard', 'GET', `/api/v1/dashboard${pick(['', '', '?periodDays=7', '?periodDays=90'])}`),
  search_text: (vu) => call(vu, 'search_text', 'GET', `/api/v1/search?q=${encodeURIComponent(prefix(pick(ref.words)))}`),
  search_number: (vu) => {
    const q = pick([() => pick(ref.clientNumbers), () => pick(ref.matterRefs), () => pick(ref.taskNumbers), () => String(1 + rnd(25000)), () => `${pick(ref.clientNumbers)}-0000${1 + rnd(5)}`])();
    return call(vu, 'search_number', 'GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
  },
  advanced_search: (vu) => {
    const variants = [
      `type=task&q=${encodeURIComponent(pick(ref.words))}&${OPEN}`,
      `type=task&requestor=${encodeURIComponent(pick(ref.words))}`,
      `type=matter&q=${encodeURIComponent(pick(ref.words))}`,
      `type=asset&q=${encodeURIComponent(pick(ref.words))}`,
      `type=project&q=Phase`,
      `type=task&matter=${pick(ref.matterIds)}`,
    ];
    return call(vu, 'advanced_search', 'GET', `/api/v1/search/advanced?${pick(variants)}&page=1&pageSize=25`);
  },
  task_detail: (vu) => call(vu, 'task_detail', 'GET', `/api/v1/tasks/${vu.nextTaskId()}`),
  task_page: async (vu) => {
    const id = vu.nextTaskId();
    const t0 = performance.now();
    const results = await Promise.all([
      call(vu, 'task_page.task', 'GET', `/api/v1/tasks/${id}`),
      call(vu, 'task_page.comments', 'GET', `/api/v1/tasks/${id}/comments`),
      call(vu, 'task_page.activity', 'GET', `/api/v1/tasks/${id}/activity`),
      call(vu, 'task_page.assets', 'GET', `/api/v1/tasks/${id}/assets`),
    ]);
    record('task_page (4 parallel)', performance.now() - t0, Math.max(...results.map((r) => r.status)));
  },
  audit_search: (vu) => {
    const variants = [
      `pageSize=50`,
      `eventType=TASK_STATUS_CHANGED&pageSize=50`,
      `objectType=Task&objectId=${vu.nextTaskId()}&pageSize=50`,
      `from=${daysFromNow(-30)}&to=${daysFromNow(-7)}&pageSize=50`,
      `actor=${2 + rnd(299)}&pageSize=50`,
      `q=${encodeURIComponent('completed')}&pageSize=50`,
    ];
    return call(vu, 'audit_search', 'GET', `/api/v1/audit/search?${pick(variants)}`);
  },
  task_create: async (vu) => {
    const r = await call(vu, 'task_create', 'POST', '/api/v1/tasks', newTaskBody(vu));
    if (r.json?.taskId) vu.created = r.json;
    return r;
  },
  comment_add: async (vu) => {
    const id = vu.created?.taskId ?? vu.nextTaskId();
    return call(vu, 'comment_add', 'POST', `/api/v1/tasks/${id}/comments`, { bodyHtml: `<p>Load test note ${rnd(1e6)} with <strong>formatting</strong> and a <a href="https://example.com/x">link</a>.</p>` });
  },
  // create a Task, start its first step, complete it (the step form values are saved first), then add a comment
  workflow_cycle: async (vu) => {
    const created = await call(vu, 'task_create', 'POST', '/api/v1/tasks', newTaskBody(vu));
    const task = created.json;
    if (!task?.taskId) return;
    vu.created = task;
    await sleep(THINK_MIN);
    const step = task.workflow.steps[0];
    const started = await call(vu, 'step_start', 'POST', `/api/v1/tasks/${task.taskId}/workflow/steps/${step.stepInstanceId}/start`, { rowVersion: task.workflow.rowVersion });
    if (!started.json) return;
    let t = started.json.task ?? started.json;
    await sleep(THINK_MIN);
    const values = await call(vu, 'step_values', 'POST', `/api/v1/tasks/${task.taskId}/workflow/steps/${step.stepInstanceId}/values`, { rowVersion: t.workflow.rowVersion, values: await stepValues(t, step.stepInstanceId) });
    if (values.json) t = values.json.task ?? t;
    await sleep(THINK_MIN);
    const done = await call(vu, 'step_complete', 'POST', `/api/v1/tasks/${task.taskId}/workflow/steps/${step.stepInstanceId}/complete`, { rowVersion: t.workflow.rowVersion });
    if (done.json && process.env.LT_DEBUG) console.error('cycle ok');
  },
};

// minimal valid input for the required fields of a step form (schemas are fetched once as the admin)
const schemaValues = new Map();
async function stepValues(task, stepInstanceId) {
  const step = task.workflow.steps.find((s) => s.stepInstanceId === stepInstanceId);
  const versionId = step?.inputFormVersionId;
  if (!versionId) return {};
  if (!schemaValues.has(versionId)) {
    const schema = await getJson(`/api/v1/forms/versions/${versionId}/schema`);
    const values = {};
    for (const f of schema.fields.filter((x) => x.required)) {
      switch (f.control) {
        case 'CHECKBOX': values[f.key] = true; break;
        case 'SELECT': case 'RADIO': values[f.key] = f.options[0]?.key; break;
        case 'MULTISELECT': values[f.key] = [f.options[0]?.key]; break;
        case 'NUMBER': values[f.key] = 1; break;
        case 'DATE': values[f.key] = iso(today); break;
        case 'URL': values[f.key] = 'https://example.com/x'; break;
        default: values[f.key] = 'Load test value';
      }
    }
    schemaValues.set(versionId, values);
  }
  return schemaValues.get(versionId);
}

function newTaskBody(vu) {
  return {
    matterId: pick(ref.activeMatterIds),
    taskTypeId: 15,
    workflowDefinitionId: 6,
    title: `Load test task ${vu.id}-${rnd(1e6)}`,
    requestorName: 'Pat Partner',
    requestorEmail: 'pat.partner@client.example',
    dueDate: daysFromNow(3 + rnd(20)),
    formValues: { category: 'other', details_needed: 'Created by the load test.', deadline_driver: 'other' },
  };
}

// persona -> scenario weights
const PERSONAS = {
  technician: { range: [31, 245], weights: { my_work: 22, queue_default: 8, queue_filtered: 6, queue_sorted: 4, task_detail: 12, task_page: 8, comment_add: 5, workflow_cycle: 5, search_text: 6, search_number: 4, pod_work: 4, advanced_search: 2 } },
  lead: { range: [16, 30], weights: { pod_work: 25, queue_default: 10, queue_filtered: 10, queue_sorted: 5, task_detail: 8, task_page: 7, dashboard: 10, search_text: 8, search_number: 5, advanced_search: 4, comment_add: 3, my_work: 5 } },
  manager: { range: [1, 15], weights: { dashboard: 25, queue_default: 10, queue_filtered: 10, queue_sorted: 8, task_detail: 6, task_page: 6, search_text: 10, search_number: 5, advanced_search: 8, pod_work: 4, my_work: 3 } },
  intake: { range: [246, 270], weights: { task_create: 20, queue_default: 15, queue_filtered: 8, search_text: 15, search_number: 10, task_detail: 7, task_page: 5, advanced_search: 5, my_work: 5, comment_add: 3 } },
  auditor: { range: [296, 300], weights: { audit_search: 40, search_text: 10, task_detail: 5, task_page: 5, queue_default: 10, advanced_search: 5 } },
};
// share of virtual users per persona
const MIX = [['technician', 0.62], ['lead', 0.12], ['manager', 0.08], ['intake', 0.12], ['auditor', 0.06]];

function assignPersonas(n) {
  const list = [];
  const counters = {};
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const x = (i + 0.5) / n;
    let name = MIX[0][0];
    for (const [p, share] of MIX) {
      acc += share;
      if (x <= acc) { name = p; break; }
    }
    const persona = PERSONAS[name];
    const c = (counters[name] = (counters[name] ?? 0));
    counters[name]++;
    const [lo, hi] = persona.range;
    list.push({ id: i, persona: name, user: userName(lo + (c % (hi - lo + 1))), weights: persona.weights });
  }
  return list;
}

function weightedPick(weights) {
  const entries = Object.entries(weights).filter(([k]) => !ONLY || ONLY.has(k));
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = Math.random() * total;
  for (const [k, w] of entries) { if ((x -= w) < 0) return k; }
  return entries[0][0];
}

// ---------------------------------------------------------------- run
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  await loadReferenceData();
  const vus = assignPersonas(VUS).map((v) => ({
    ...v,
    created: null,
    taskCursor: rnd(ref.taskIds.length),
    nextTaskId() {
      // 10% of detail loads hit one of the long comment threads, the rest a random Task
      return Math.random() < 0.1 ? pick(ref.hotTaskIds) : pick(ref.taskIds);
    },
  }));
  console.error(`base=${BASE} vus=${VUS} duration=${DURATION / 1000}s warmup=${WARMUP / 1000}s think=${THINK_MIN}-${THINK_MAX}ms tasks sampled=${ref.taskIds.length}`);
  let stop = false;
  const loops = vus.map(async (vu) => {
    await sleep(rnd(1000)); // spread the starts
    while (!stop) {
      const name = weightedPick(vu.weights);
      try { await scenarios[name](vu); } catch (e) { if (process.env.LT_DEBUG) console.error('scenario', name, e); }
      await sleep(THINK_MIN + rnd(THINK_MAX - THINK_MIN + 1));
    }
  });
  await sleep(WARMUP);
  recording = true;
  recordStart = performance.now();
  await sleep(DURATION);
  recording = false;
  const elapsed = (performance.now() - recordStart) / 1000;
  stop = true;
  await Promise.all(loops);

  const rows = [...stats.entries()].map(([name, s]) => {
    const sorted = Float64Array.from(s.ms).sort();
    return { scenario: name, count: sorted.length, errors: s.errors, rps: +(sorted.length / elapsed).toFixed(2), p50: +percentile(sorted, 50).toFixed(1), p95: +percentile(sorted, 95).toFixed(1), p99: +percentile(sorted, 99).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1), statuses: s.statuses };
  }).sort((a, b) => a.scenario.localeCompare(b.scenario));
  const total = rows.filter((r) => !r.scenario.startsWith('task_page.')).reduce((s, r) => s + (r.scenario.startsWith('task_page (') ? 0 : r.count), 0);
  const totalErrors = rows.filter((r) => !r.scenario.startsWith('task_page (')).reduce((s, r) => s + r.errors, 0);
  const result = { vus: VUS, durationSeconds: +elapsed.toFixed(1), thinkMs: [THINK_MIN, THINK_MAX], totalRequests: total, totalErrors, throughputRps: +(total / elapsed).toFixed(1), rows };
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`| scenario | n | err | req/s | p50 ms | p95 ms | p99 ms | max ms |`);
  console.log(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of rows) console.log(`| ${r.scenario} | ${r.count} | ${r.errors} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`);
  console.log(`\nvus=${VUS} duration=${result.durationSeconds}s total=${total} requests, errors=${totalErrors}, throughput=${result.throughputRps} req/s`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
