// Tiny API mock built from contracts/openapi/v1.json (UI update 2, batch 3a). Usage: node server.mjs [port=5293]
// Every operation answers its 200/201 JSON schema with generated sample data (lists get 4 rows, paged lists {items,total...}). `overrides` below
// pin the few answers that need real-looking values. Nothing is persisted: a POST/PUT/DELETE answers a sample and changes nothing.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, '../../../../../contracts/openapi/v1.json'), 'utf8'));
const port = Number(process.argv[2] ?? 5293);
const schemas = spec.components.schemas;

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
const PEOPLE = ['Test User 02', 'Test User 06', 'Test User 18', 'Test User 30'];
const word = (key, i) => {
  const k = key.toLowerCase();
  if (k.includes('timezone')) return 'America/New_York';
  if (k === 'state') return 'AVAILABLE';
  if (k === 'start') return '09:00';
  if (k === 'end') return '17:00';
  if (k.includes('email')) return `user${i}@example.test`;
  if (k.includes('displayname') || k === 'username' || k.endsWith('username')) return PEOPLE[i % 4];
  if (k.includes('tasknumber')) return `TSK-${100 + i}`;
  if (k.includes('matterref') || k.includes('cmnumber')) return `9000${i + 1}-8000${i + 1}`;
  if (k.includes('clientname')) return `Demo ${['Contoso Energy', 'Northwind Holdings', 'Tailspin Aerospace', 'Fabrikam'][i % 4]}`;
  if (k.includes('color')) return ['#B42318', '#B54708', '#175CD3', '#027A48'][i % 4];
  if (k.includes('title')) return `Sample task title ${i + 1}`;
  if (k.includes('label') || k === 'name' || k.endsWith('name')) return `Sample ${NAMES[i % 4]}`;
  if (k.includes('description') || k.includes('note') || k.includes('comment')) return `Sample text ${i + 1}`;
  if (k.includes('rowversion') || k.includes('etag')) return 'AAAAAAAAB9E=';
  return `${NAMES[i % 4]} ${i + 1}`;
};

function gen(schema, key = '', i = 0, depth = 0) {
  if (!schema || depth > 9) return null;
  if (schema.$ref) return gen(schemas[schema.$ref.split('/').pop()], key, i, depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => gen(s, key, i, depth + 1) ?? {}));
  if (schema.oneOf || schema.anyOf) {
    const opts = (schema.oneOf ?? schema.anyOf).filter((s) => s.type !== 'null');
    return gen(opts[0], key, i, depth + 1);
  }
  if (schema.enum) return schema.enum[i % schema.enum.length];
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = gen(v, k, i, depth + 1);
      return fix(out, i);
    }
    case 'array': return [0, 1, 2, 3].map((n) => gen(schema.items, key, n, depth + 1));
    case 'integer': {
      const k = key.toLowerCase();
      if (k.endsWith('id')) return i + 1;
      if (k.includes('total') || k.includes('count')) return 4;
      if (k.includes('page')) return 1;
      return i + 1;
    }
    case 'number': return 12.5;
    case 'boolean': return /^is(active|current)|^can|^has/i.test(key) ? true : false;
    case 'string':
      if (schema.format === 'date-time') return `2026-11-${String(10 + i).padStart(2, '0')}T14:00:00Z`;
      if (schema.format === 'date') return `2026-11-${String(10 + i).padStart(2, '0')}`;
      return word(key, i);
    default: return null;
  }
}

/** Shape fixers: values the schema cannot say (the status words, the allowed transitions, the step states). */
function fix(o, i) {
  if ('stepInstanceId' in o && 'sequenceNo' in o) {
    Object.assign(o, { sequenceNo: i + 1, title: ['Collect the data', 'Process the files', 'Quality check', 'Deliver'][i % 4], status: i === 0 ? 'IN_PROGRESS' : 'PENDING', isCurrent: i === 0,
      isSkippable: i % 2 === 0, skipCommentRequired: i === 2, hasBeenResolved: false, requiredInputsSatisfied: true, values: {}, inputFormVersionId: null,
      description: null, instructions: null, documentationUrl: null, skipComment: null, firstResolvedAtUtc: null, resolvedAtUtc: null, resolvedByUserId: null });
  }
  if ('taskNumber' in o && 'allowedActions' in o) {
    Object.assign(o, { status: 'IN_PROGRESS', statusLabel: 'In Progress', dueTime: '17:00', timeZone: 'America/New_York', statusReason: null, onHoldReason: null,
      completedAtUtc: null, warnings: [], droppedFields: [], bulkCompletedStepInstanceIds: [], descriptionFormat: 'text', formVersionId: null, formVersionNo: null });
    o.allowedActions.transitions = [
      { action: 'COMPLETE', targetStatus: 'COMPLETED', requiresComment: false, requiredPermission: 'Task.Complete', permitted: true, blockedReason: null },
      { action: 'HOLD', targetStatus: 'ON_HOLD', requiresComment: true, requiredPermission: 'Task.ChangeStatus', permitted: true, blockedReason: null },
      { action: 'CANCEL', targetStatus: 'CANCELLED', requiresComment: true, requiredPermission: 'Task.Cancel', permitted: true, blockedReason: null },
    ];
  }
  if ('taskNumber' in o && 'status' in o && !('allowedActions' in o)) {
    const st = [['NEW', 'New'], ['IN_PROGRESS', 'In Progress'], ['NEW', 'New'], ['ON_HOLD', 'On Hold']][i % 4];
    o.status = st[0];
    if ('statusLabel' in o) o.statusLabel = st[1];
  }
  if ('workflowInstanceId' in o && 'progress' in o) {
    o.progress = { total: 4, pending: 3, inProgress: 1, completed: 0, skipped: 0, resolved: 0, currentStepInstanceId: 1, reopenedPrerequisiteStepInstanceIds: [] };
    o.isOrdered = false;
  }
  return o;
}

const ops = [];
for (const [path, item] of Object.entries(spec.paths)) {
  const re = new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$');
  for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const ok = op.responses?.['200'] ?? op.responses?.['201'] ?? op.responses?.['204'];
    const schema = ok?.content?.['application/json']?.schema;
    ops.push({ method: method.toUpperCase(), re, path, schema, status: op.responses?.['200'] ? 200 : op.responses?.['201'] ? 201 : 204 });
  }
}

/** Pinned answers: [METHOD, path regex, (url) => body]. First match wins, before the generated one. */
const STEPS = [1, 2, 3].map((n) => ({ stepInstanceId: n, sequenceNo: n, title: ['Collect the data', 'Process the files', 'Quality check'][n - 1] }));
const overrides = [
  ['GET', /\/tasks\/\d+\/completion$/, () => ({ isReady: false, canBulkComplete: true, unresolved: STEPS, bulkCompletable: STEPS, blocked: [], workflowRowVersion: 'AAAAAAAAB9E=' })],
  ['GET', /\/lookups\/priorities/, () => [
    { priorityId: 1, id: 1, label: 'Critical', color: '#B42318', rank: 1, isActive: true, isDefault: false },
    { priorityId: 2, id: 2, label: 'High', color: '#B54708', rank: 2, isActive: true, isDefault: false },
    { priorityId: 3, id: 3, label: 'Normal', color: '#475467', rank: 3, isActive: true, isDefault: true },
  ]],
];

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  let hit = overrides.find(([m, re]) => m === req.method && re.test(path));
  if (hit) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(hit[2](url)));
  }
  // The most specific path wins (fewest {template} parts, then the longest literal).
  const params = (o) => (o.path.match(/\{/g) ?? []).length;
  const found = ops.filter((o) => o.method === req.method && o.re.test(path)).sort((a, b) => params(a) - params(b) || b.path.length - a.path.length)[0];
  if (!found) {
    res.writeHead(404, { 'content-type': 'application/problem+json' });
    return res.end(JSON.stringify({ title: 'No mock', status: 404 }));
  }
  if (found.status === 204 || !found.schema) {
    res.writeHead(found.status);
    return res.end();
  }
  res.writeHead(found.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(gen(found.schema)));
}).listen(port, '127.0.0.1', () => console.log(`mock api on http://127.0.0.1:${port}`));
