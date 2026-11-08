#!/usr/bin/env node
// Completeness check of the database pages of the wiki against db/scripts (the baseline 00-baseline.sql and the numbered scripts after it,
// plus the archived chain in db/scripts/archive; run from the repository root):
//   node wiki/tools/check-db-docs.mjs
// It reads the SQL scripts (no database needed), lists every table and every named foreign key, and checks that
//   - every table has a "### <Table>" entry in wiki/Database/Table-Reference.md and an entity block in wiki/Database/ER-Diagrams.md,
//   - every foreign key name appears in Table-Reference.md,
//   - every script file (baseline, later scripts and the archived ones) appears in wiki/Database/Schema-Script-History.md.
// Exit code 1 when something is missing. It is a text check, not a SQL parser: it recognises CREATE TABLE, CONSTRAINT FK_x FOREIGN KEY
// and DROP CONSTRAINT FK_x. The runner table dbo.SchemaMigration is created by the application, not by a script, and is added by hand.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptsDir = join(root, 'db', 'scripts');
const dbDir = join(root, 'wiki', 'Database');
const archiveDir = join(scriptsDir, 'archive');
const files = readdirSync(scriptsDir).filter((f) => /^\d+-.*\.sql$/.test(f)).sort();
const archived = readdirSync(archiveDir).filter((f) => /^\d+-.*\.sql$/.test(f)).sort();

const tables = new Set(['SchemaMigration']);
const fks = new Set();
// The baseline and later scripts define the current schema; the archive (01 to 66) is history and is not read for tables or keys.
for (const f of files) {
  const sql = readFileSync(join(scriptsDir, f), 'utf8');
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+\[?dbo\]?\.\[?(\w+)\]?/gi)) tables.add(m[1]);
  for (const m of sql.matchAll(/CONSTRAINT\s+(FK_\w+)\s+FOREIGN\s+KEY/gi)) fks.add(m[1]);
  for (const m of sql.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(FK_\w+)/gi)) fks.delete(m[1]);
}

const ref = readFileSync(join(dbDir, 'Table-Reference.md'), 'utf8');
const er = readFileSync(join(dbDir, 'ER-Diagrams.md'), 'utf8');
const hist = readFileSync(join(dbDir, 'Schema-Script-History.md'), 'utf8');
const problems = [];

for (const t of tables) {
  if (!new RegExp(`^### ${t}$`, 'm').test(ref)) problems.push(`table ${t}: no "### ${t}" entry in Table-Reference.md`);
  if (!new RegExp(`^  ${t} \\{$`, 'm').test(er)) problems.push(`table ${t}: no entity block in ER-Diagrams.md`);
}
for (const fk of fks) {
  if (!ref.includes('`' + fk + '`')) problems.push(`foreign key ${fk}: not listed in Table-Reference.md`);
}
for (const f of [...files, ...archived]) {
  if (!hist.includes('`' + f + '`')) problems.push(`script ${f}: not listed in Schema-Script-History.md`);
}

console.log(`scripts: ${files.length} (+ ${archived.length} archived), tables: ${tables.size}, named foreign keys: ${fks.size}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('OK: every table, foreign key and script is documented.');
