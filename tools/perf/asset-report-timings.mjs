#!/usr/bin/env node
// Times the asset report engine (epic #851, issue #873) at 100,000 assets: creates an asset type with a published form (a number "size_gb" and a
// select "platform"), loads the dataset (seed-asset-report-data.sql, in the SQL container), and runs POST /api/v1/asset-reports/run for the
// report shapes of the builder, 40 runs each (the first 5 are warm-up and dropped, the very first call is shown as "cold").
//
//   node tools/perf/asset-report-timings.mjs --base http://127.0.0.1:5271 --container mf-e2e-sql-1234 [--assets 100000] [--runs 40] [--reuse <assetTypeId>] [--plans]
//   (SQL password MatterFlow_Dev1!, Dev auth user ke\kekim, the defaults of frontend/e2e/run-local.sh)
//
// With --plans it also prints, for each shape, the statement count and the logical reads and index scans seen in the plan cache (sys.dm_exec_*).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://127.0.0.1:5190');
const container = arg('container', '');
const assets = Number(arg('assets', '100000'));
const runs = Number(arg('runs', '40'));
const user = 'ke\\kekim';
const password = 'MatterFlow_Dev1!';
const here = dirname(fileURLToPath(import.meta.url));
if (!container) throw new Error('--container <sql container name> is required');

const headers = { 'X-Dev-User': user, 'X-MatterFlow-Client': 'web', 'Content-Type': 'application/json' };
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) =>
  execFileSync('docker', ['exec', container, '/opt/mssql-tools18/bin/sqlcmd', '-C', '-S', 'localhost', '-U', 'sa', '-P', password, '-d', 'MatterFlow', '-I', '-b', '-W', '-s', '|', '-Q', query], { encoding: 'utf8' });

// 1. the type and its form (--reuse <assetTypeId>: the data of an earlier run is there, only time it again)
const reuse = arg('reuse', '');
const stamp = Date.now().toString(36);
const type = reuse ? { assetTypeId: Number(reuse) } : await api('POST', '/api/v1/asset-types', { name: `Perf workspace ${stamp}`, description: null, sortOrder: 6400 });
if (!reuse) {
const definition = await api('GET', `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${type.assetTypeId}`);
const draft = await api('POST', `/api/v1/forms/${definition.formDefinitionId}/versions`);
const fields = [
  { key: 'size_gb', label: 'Size', control: 'NUMBER' },
  { key: 'platform', label: 'Platform', control: 'SELECT', options: ['prod', 'test', 'dev', 'archive', 'staging'].map((k) => ({ key: k, label: k })) },
];
const saved = await api('PUT', `/api/v1/forms/${definition.formDefinitionId}/versions/${draft.version.formVersionId}`, { fields, rowVersion: draft.version.rowVersion });
await api('POST', `/api/v1/forms/${definition.formDefinitionId}/versions/${saved.version.formVersionId}/publish?rowVersion=${encodeURIComponent(saved.version.rowVersion)}`);
const current = await api('GET', `/api/v1/asset-types/${type.assetTypeId}`);
await api('PUT', `/api/v1/asset-types/${type.assetTypeId}/size-field`, { sizeFieldKey: 'size_gb', sizeUnit: 'GB', rowVersion: current.rowVersion });

// 2. the data
let script = readFileSync(join(here, 'seed-asset-report-data.sql'), 'utf8');
for (const [k, v] of Object.entries({ Assets: assets, TypeId: type.assetTypeId, FieldDefinitionId: definition.formDefinitionId, Manager: user })) script = script.replaceAll(`$(${k})`, String(v));
execFileSync('docker', ['exec', '-i', container, 'sh', '-c', 'cat > /tmp/seed-asset-report-data.sql'], { input: script });
const t0 = Date.now();
console.log(execFileSync('docker', ['exec', container, '/opt/mssql-tools18/bin/sqlcmd', '-C', '-S', 'localhost', '-U', 'sa', '-P', password, '-d', 'MatterFlow', '-I', '-b', '-W', '-i', '/tmp/seed-asset-report-data.sql'], { encoding: 'utf8' }).trim());
console.log(`loaded in ${Math.round((Date.now() - t0) / 1000)} s`);
sql('UPDATE STATISTICS dbo.Asset; UPDATE STATISTICS dbo.CustomFieldIndex;');
}

// 3. the shapes
const def = (over) => ({ v: 1, assetTypeId: type.assetTypeId, measure: 'count', groupBy: 'disposition', scope: 'mine', ...over });
const shapes = [
  ['Count by disposition', def({})],
  ['Sum of size by disposition', def({ measure: 'sum', numberField: 'size_gb' })],
  ['Average of size by platform (select field)', def({ measure: 'average', numberField: 'size_gb', groupBy: 'field:platform' })],
  ['Sum of size by matter (100 groups)', def({ measure: 'sum', numberField: 'size_gb', groupBy: 'matter' })],
  ['Sum of size by client', def({ measure: 'sum', numberField: 'size_gb', groupBy: 'client' })],
  ['Sum by asset type, all asset types, scope all', def({ assetTypeId: undefined, measure: 'sum', groupBy: 'assetType', scope: 'all' })],
  ['Count by platform, scope all', def({ groupBy: 'field:platform', scope: 'all' })],
  ['Sum of size by platform, Active only', def({ measure: 'sum', numberField: 'size_gb', groupBy: 'field:platform', dispositions: ['ACTIVE'] })],
];
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
console.log(`\n${assets} assets, ${assets * 2} index rows, ${runs} runs per shape (5 warm-up dropped)\n`);
console.log('| Report | cold ms | p50 ms | p95 ms | max ms | groups | assets counted |');
console.log('|---|---|---|---|---|---|---|');
for (const [name, body] of shapes) {
  const times = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    last = await api('POST', '/api/v1/asset-reports/run', body);
    times.push(performance.now() - s);
  }
  const cold = times[0];
  const warm = times.slice(5).sort((a, b) => a - b);
  console.log(`| ${name} | ${cold.toFixed(0)} | ${pct(warm, 50).toFixed(0)} | ${pct(warm, 95).toFixed(0)} | ${warm.at(-1).toFixed(0)} | ${last.rows.length} | ${last.assets} |`);
}

if (process.argv.includes('--plans')) {
  console.log('\nPlan cache, statements that read CustomFieldIndex or Asset (last_logical_reads, executions):\n');
  console.log(sql(`SELECT TOP 12 qs.execution_count AS execs, qs.total_worker_time / qs.execution_count / 1000 AS avg_cpu_ms, qs.total_elapsed_time / qs.execution_count / 1000 AS avg_ms,
      qs.last_logical_reads AS reads, CASE WHEN CAST(qp.query_plan AS NVARCHAR(MAX)) LIKE '%JSON_VALUE%' THEN 'JSON_VALUE' ELSE 'no JSON' END AS json,
      CASE WHEN CAST(qp.query_plan AS NVARCHAR(MAX)) LIKE '%PhysicalOp="Index Seek"%' THEN 'index seek' ELSE 'no seek' END AS seek,
      CASE WHEN CAST(qp.query_plan AS NVARCHAR(MAX)) LIKE '%Parallel="1"%' THEN 'parallel' ELSE 'serial' END AS dop
    FROM sys.dm_exec_query_stats qs CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
    WHERE st.text LIKE '%CustomFieldIndex%' AND st.text LIKE '%GROUP BY%' ORDER BY qs.total_elapsed_time DESC`));
}
