// Mocked LPT Hub API for the Reports screens: a static server with SPA fallback and Playwright route handlers. Writes nothing anywhere.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function serve(dist, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.txt': 'text/plain' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dist, p);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

const perms = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contracts/permissions.json'), 'utf8')).permissions.map((p) => p.code);
const ME = { userId: 1, displayName: 'Test Admin', status: 'Active', isPending: false, windowsAccount: 'MF\\admin', email: 'admin@example.test', registeredAtUtc: '2026-01-01T00:00:00Z', roles: ['System Admin'], permissions: perms, isSystemAdmin: true, hasWork: true, pods: [] };

const COLS = [
  { name: 'Id', type: 'integer' }, { name: 'Matter', type: 'text' }, { name: 'Client', type: 'text' }, { name: 'Hours', type: 'decimal' },
  { name: 'Open Tasks', type: 'integer' }, { name: 'Due', type: 'date' }, { name: 'Updated', type: 'dateTime' }, { name: 'Active', type: 'boolean' },
];
export const TWIN = [{ name: 'Name', type: 'text' }, { name: 'Name', type: 'text' }, { name: 'Id', type: 'integer' }];
export const TWIN_ROWS = [['Acme Holdings', 'Smith, Ann', 1], ['Acme Holdings', 'Jones, Bob', 2], ['Beta Partners', 'Smith, Carl', 3], ['Gamma LLC', 'Lee, Dee', 4]];
export function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = [i + 1, `Matter ${String(i + 1).padStart(5, '0')} v. Counterparty ${i % 977}`, `Client ${i % 313}`, Math.round(((i * 37) % 10000) / 7) / 100, (i * 13) % 41, `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, `2026-11-0${(i % 7) + 1}T1${i % 10}:05:00Z`, i % 3 === 0];
  }
  return rows;
}

const PARAMS5 = [
  { name: 'MAX', type: 'number', label: 'Highest Number', helpText: undefined, required: true, default: 10, multiple: false, options: [], min: 1, max: 100, integerOnly: true },
  { name: 'CLIENT', type: 'lookup', label: 'Client', required: true, multiple: false, lookupKind: 'client', options: [] },
  { name: 'PODS', type: 'lookup', label: 'Pods', required: false, multiple: true, lookupKind: 'pod', options: [] },
  { name: 'PERIOD', type: 'dateRange', label: 'Period', required: false, multiple: false, options: [] },
  { name: 'STATUS', type: 'single', label: 'Status', required: false, multiple: false, valueType: 'text', choicesSource: 'fixed', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }] },
  { name: 'INCL', type: 'yesNo', label: 'Include Inactive', required: false, multiple: false, options: [] },
  { name: 'NOTE', type: 'text', label: 'Note Contains', required: false, multiple: false, maxLength: 60, options: [] },
].map((p) => ({ helpText: undefined, default: undefined, lookupKind: undefined, valueType: undefined, choicesSource: undefined, min: undefined, max: undefined, integerOnly: false, maxLength: undefined, maxSelected: undefined, ...p }));

export function createState(opts = {}) {
  const st = {
    me: ME,
    big: makeRows(50000),
    small: makeRows(2380),
    views: [
      { viewId: 1, name: 'Weekly review', isDefault: false, layout: { columns: [], sort: [], filters: [], pageSize: 50 }, createdAtUtc: '2026-11-01T10:00:00Z', ignoredColumns: [] },
      { viewId: 2, name: 'Open work', isDefault: false, layout: { columns: [], sort: [], filters: [], pageSize: 100 }, createdAtUtc: '2026-11-02T10:00:00Z', ignoredColumns: [] },
    ],
    nextViewId: 3,
    runDelayMs: 0,
    exportDelayMs: 0,
    unmatched: new Set(),
    requests: [],
    rowsRequests: [],
    ...opts,
  };
  return st;
}

const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

function sortFilter(rows, search) {
  const sort = search.get('sort');
  const filter = search.get('filter');
  let out = rows;
  if (filter) {
    for (const f of JSON.parse(filter)) {
      const i = Number(String(f.column).slice(1));
      if (f.op === 'contains') out = out.filter((r) => String(r[i]).toLowerCase().includes(String(f.value).toLowerCase()));
      else if (f.op === 'gte') out = out.filter((r) => Number(r[i]) >= Number(f.value));
      else if (f.op === 'lte') out = out.filter((r) => Number(r[i]) <= Number(f.value));
    }
  }
  if (sort) {
    const m = /^#(\d+):(asc|desc)$/.exec(sort);
    if (m) {
      const i = Number(m[1]);
      const dir = m[2] === 'desc' ? -1 : 1;
      out = [...out].sort((a, b) => (a[i] < b[i] ? -dir : a[i] > b[i] ? dir : 0));
    }
  }
  return out;
}

export async function install(page, st) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\/v1/, '');
    const m = req.method();
    st.requests.push(`${m} ${p}${url.search}`);
    let x;
    if (p === '/me' && m === 'GET') return json(route, st.me);
    // ---- people-facing reports
    if (p === '/reports' && m === 'GET')
      return json(route, { totalReports: 3, categories: [
        { categoryId: 1, name: 'Task follow-up', sortOrder: 1, reports: [
          { reportId: 5, name: 'Overdue tasks', description: 'Tasks past their due date', sortOrder: 1, parameterCount: 7, hasParameters: true, parameterLabels: ['Highest Number', 'Client', 'Pods'], lastRunAtUtc: '2026-11-05T10:00:00Z' },
          { reportId: 6, name: 'Tasks per matter', description: 'Open tasks counted per matter', sortOrder: 2, parameterCount: 0, hasParameters: false, parameterLabels: [] },
        ] },
        { categoryId: 2, name: 'Finance', sortOrder: 2, reports: [
          { reportId: 7, name: 'Large result', description: 'Fifty thousand rows, for the performance look', sortOrder: 1, parameterCount: 0, hasParameters: false, parameterLabels: [] },
        ] },
      ] });
    if ((x = /^\/reports\/(\d+)$/.exec(p)) && m === 'GET') {
      const id = Number(x[1]);
      const names = { 5: 'Overdue tasks', 6: 'Tasks per matter', 7: 'Large result', 8: 'Client and matter names' };
      if (!names[id]) return json(route, { status: 404, title: 'Not found' }, 404);
      return json(route, { reportId: id, name: names[id], description: 'Tasks past their due date, counted for the people who run reports.', helpText: 'Counts tasks. Start with the highest number you need.', categoryId: 1, categoryName: 'Task follow-up', versionNo: 2, timeoutSeconds: 60, maxRows: 50000, parameters: id === 5 ? PARAMS5 : [] });
    }
    if ((x = /^\/reports\/(\d+)\/runs$/.exec(p)) && m === 'POST') {
      if (st.runDelayMs) await new Promise((r) => setTimeout(r, st.runDelayMs));
      const id = Number(x[1]);
      const big = id === 7;
      if (id === 8) { st.run = { id, rows: TWIN_ROWS, cols: TWIN }; return json(route, { runId: 'run-8', columns: TWIN, rowCount: TWIN_ROWS.length, truncated: false, durationMs: 20, maxRows: 50000 }); }
      st.run = { id, rows: big ? st.big : st.small };
      return json(route, { runId: `run-${id}`, columns: COLS, rowCount: st.run.rows.length, truncated: big, durationMs: 120, maxRows: 50000 });
    }
    if (p === '/reports/runs/current' && m === 'DELETE') return route.fulfill({ status: 204 });
    if ((x = /^\/reports\/runs\/([^/]+)$/.exec(p)) && m === 'DELETE') return route.fulfill({ status: 204 });
    if ((x = /^\/reports\/runs\/([^/]+)\/rows$/.exec(p)) && m === 'GET') {
      const rows = st.run?.rows ?? st.small;
      const page_ = Number(url.searchParams.get('page') ?? 1);
      const size = Number(url.searchParams.get('pageSize') ?? 50);
      const t0 = Date.now();
      const filtered = sortFilter(rows, url.searchParams);
      const slice = filtered.slice((page_ - 1) * size, page_ * size);
      const body = JSON.stringify({ columns: st.run?.cols ?? COLS, rows: slice, totalRows: rows.length, filteredRows: filtered.length, page: page_, pageSize: size, truncated: rows.length === 50000 });
      st.rowsRequests.push({ page: page_, size, bytes: body.length, rowsSent: slice.length, serverMs: Date.now() - t0 });
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    if ((x = /^\/reports\/runs\/([^/]+)\/export\.csv$/.exec(p)) && m === 'GET') {
      if (st.exportDelayMs) await new Promise((r) => setTimeout(r, st.exportDelayMs));
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="overdue-tasks-20261107-1405.csv"', 'X-Export-Rows': '2380', 'X-Export-Truncated': 'false' }, body: '﻿Id,Matter\r\n1,A\r\n' });
    }
    if ((x = /^\/reports\/(\d+)\/lookups\/([^/]+)$/.exec(p)) && m === 'GET') {
      const kind = x[2].toUpperCase();
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const all = kind === 'PODS' ? [{ id: 1, label: 'Pod A' }, { id: 2, label: 'Pod B' }, { id: 3, label: 'Pod C' }] : [{ id: 9, label: '00017 Acme Holdings' }, { id: 10, label: '00018 Beta Partners' }, { id: 11, label: '00019 Gamma LLC' }];
      return json(route, all.filter((a) => a.label.toLowerCase().includes(q)));
    }
    if ((x = /^\/reports\/(\d+)\/choices\//.exec(p)) && m === 'GET') return json(route, { options: [], truncated: false });
    // ---- saved views
    if ((x = /^\/reports\/(\d+)\/views$/.exec(p))) {
      if (m === 'GET') return json(route, { views: st.views, limit: 25 });
      if (m === 'POST') {
        const b = req.postDataJSON();
        const v = { viewId: st.nextViewId++, name: b.name, isDefault: !!b.isDefault, layout: b.layout, createdAtUtc: new Date().toISOString(), ignoredColumns: [] };
        st.views.push(v);
        return json(route, v, 201);
      }
    }
    if ((x = /^\/reports\/(\d+)\/views\/(\d+)$/.exec(p))) {
      const v = st.views.find((a) => a.viewId === Number(x[2]));
      if (m === 'PUT') { Object.assign(v, req.postDataJSON()); return json(route, v); }
      if (m === 'DELETE') { st.views = st.views.filter((a) => a !== v); return route.fulfill({ status: 204 }); }
    }
    if ((x = /^\/reports\/(\d+)\/views\/(\d+)\/default$/.exec(p))) {
      const v = st.views.find((a) => a.viewId === Number(x[2]));
      for (const a of st.views) a.isDefault = false;
      v.isDefault = m === 'POST';
      return json(route, v);
    }
    // ---- report setup (admin)
    const cat = (id, name, n) => ({ categoryId: id, name, sortOrder: id, isActive: true, reportCount: n, rowVersion: 'AAAA' });
    if (p === '/report-admin/categories' && m === 'GET') return json(route, [cat(1, 'Task follow-up', 2), cat(2, 'Finance', 1)]);
    if (p === '/report-admin/reports' && m === 'GET') {
      const item = (id, name, c, cn, active, roles) => ({ reportId: id, name, categoryId: c, categoryName: cn, sortOrder: id, description: 'Description', isActive: active, versionNo: 2, previewed: true, roleCount: roles, lastRunAtUtc: '2026-11-05T10:00:00Z', modifiedAtUtc: '2026-11-04T10:00:00Z', rowVersion: 'AAAA' });
      return json(route, { total: 3, items: [item(5, 'Overdue tasks', 1, 'Task follow-up', true, 2), item(6, 'Tasks per matter', 1, 'Task follow-up', true, 1), item(7, 'Large result', 2, 'Finance', false, 0)] });
    }
    if ((x = /^\/report-admin\/reports\/(\d+)$/.exec(p)) && m === 'GET')
      return json(route, { reportId: Number(x[1]), name: 'Overdue tasks', categoryId: 1, categoryName: 'Task follow-up', description: 'Tasks past their due date', helpText: 'Counts tasks.', sortOrder: 1, isActive: true, timeoutSeconds: 60, maxRows: 50000, versionId: 11, versionNo: 2, sql: 'SELECT t.TaskId, t.Title\nFROM Task t\nWHERE t.DueDate < :AS_OF AND t.PodId = :POD', parameters: [{ name: 'AS_OF', type: 'date', label: 'As Of', isRequired: true }, { name: 'POD', type: 'lookup', label: 'Pod', lookupKind: 'pod' }], changeNote: 'Initial', canActivate: true, roleCount: 2, createdAtUtc: '2026-10-01T10:00:00Z', createdByName: 'Test Admin', modifiedAtUtc: '2026-11-04T10:00:00Z', modifiedByName: 'Test Admin', rowVersion: 'AAAA' });
    if ((x = /^\/report-admin\/reports\/(\d+)\/versions$/.exec(p)) && m === 'GET')
      return json(route, [{ versionId: 11, versionNo: 2, createdAtUtc: '2026-11-04T10:00:00Z', createdByUserId: 1, createdByName: 'Test Admin', changeNote: 'Added the pod', isCurrent: true, hash: 'abc' }, { versionId: 10, versionNo: 1, createdAtUtc: '2026-10-01T10:00:00Z', createdByUserId: 1, createdByName: 'Test Admin', changeNote: 'Initial', isCurrent: false, hash: 'def' }]);
    if ((x = /^\/report-admin\/reports\/(\d+)\/roles$/.exec(p)) && m === 'GET')
      return json(route, [{ roleId: 2, name: 'Pod Lead', isActive: true, isSystemAdmin: false, memberCount: 4, assigned: true }, { roleId: 3, name: 'Director', isActive: true, isSystemAdmin: false, memberCount: 2, assigned: false }, { roleId: 4, name: 'Old role', isActive: false, isSystemAdmin: false, memberCount: 0, assigned: false }]);
    if ((x = /^\/report-admin\/roles\/(\d+)\/reports$/.exec(p)) && m === 'GET')
      return json(route, [{ reportId: 5, name: 'Overdue tasks', categoryId: 1, categoryName: 'Task follow-up', categorySortOrder: 1, sortOrder: 1, description: 'Past due', isActive: true, assigned: true }, { reportId: 6, name: 'Tasks per matter', categoryId: 1, categoryName: 'Task follow-up', categorySortOrder: 1, sortOrder: 2, isActive: true, assigned: false }]);
    if (p === '/report-admin/assignment-matrix' && m === 'GET')
      return json(route, { roles: [{ id: 2, name: 'Pod Lead' }, { id: 3, name: 'Director' }], reports: [{ reportId: 5, name: 'Overdue tasks', categoryId: 1, categoryName: 'Task follow-up', categorySortOrder: 1, sortOrder: 1, isActive: true, assigned: true }, { reportId: 6, name: 'Tasks per matter', categoryId: 1, categoryName: 'Task follow-up', categorySortOrder: 1, sortOrder: 2, isActive: true, assigned: false }], cells: [{ roleId: 2, reportId: 5 }, { roleId: 3, reportId: 6 }] });
    if (p === '/report-admin/runs' && m === 'GET')
      return json(route, { items: [{ runId: 1, reportId: 5, reportName: 'Overdue tasks', userId: 1, userName: 'Test Admin', kind: 'Run', status: 'Succeeded', startedAtUtc: '2026-11-05T10:00:00Z', durationMs: 120, rowCount: 2380, parameters: ['MAX'], versionNo: 2 }], nextBefore: undefined });
    if (p === '/report-admin/status' && m === 'GET')
      return json(route, { enabled: true, state: 'Ready', message: 'Reports can run.', login: { name: 'lpt_reports', allowedTables: 12, deniedTables: 33, grants: [], denies: [] } });
    if (p === '/report-admin/schema' && m === 'GET') return json(route, { items: [{ name: 'Task', description: 'Tasks', columnCount: 14 }], total: 1, page: 1, pageSize: 50 });
    if (p === '/roles' && m === 'GET') return json(route, [{ roleId: 2, name: 'Pod Lead', description: 'Runs a pod', isSystemAdmin: false, memberCount: 4, permissionCount: 6 }, { roleId: 3, name: 'Director', description: 'Directs', isSystemAdmin: false, memberCount: 2, permissionCount: 12 }]);
    if ((x = /^\/roles\/(\d+)$/.exec(p)) && m === 'GET') return json(route, { roleId: Number(x[1]), name: 'Pod Lead', description: 'Runs a pod', isSystemAdmin: false, memberCount: 4, permissionCodes: ['Report.Run', 'Matter.View'], rowVersion: 'AAAA' });
    // ---- the shell and everything else
    if (m === 'GET') {
      st.unmatched.add(`GET ${p}`);
      return json(route, /s$|list$/.test(p) ? [] : {});
    }
    st.unmatched.add(`${m} ${p}`);
    return json(route, {});
  });
}
export { COLS };
