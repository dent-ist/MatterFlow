#!/usr/bin/env node
// Mechanical rename MatterFlow -> LPT Hub (issue #1346, epic #1345). Rules and decisions: docs/rename/rename-map.md.
//
//   node tools/rename/rename.mjs            dry run (default): changes nothing, prints a markdown summary
//   node tools/rename/rename.mjs --apply    1. git mv of paths (history follows), 2. content rules, on the working tree
//   node tools/rename/rename.mjs --check    completeness check: exit 1 if the old name still appears outside the allow-list
//
// Options: --list-review  print every line the "needs a human look" rules touched (default: counts and a short sample)
//          --list-all     print every changed line per rule (long)
//          --force        allow --apply on a dirty tree or on dev/main (never do this on the real branches without the owner)
//          --root <dir>   repository root (default: the git top-level of the current directory)
// No packages needed (Node 18+). Files that are binary, not valid UTF-8 or symbolic links are never rewritten.
// Line endings (CRLF/LF) and a UTF-8 byte-order mark are preserved because the rules never touch them.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const APPLY = flag('--apply');
const CHECK = flag('--check');
const LIST_REVIEW = flag('--list-review');
const LIST_ALL = flag('--list-all');
const FORCE = flag('--force');
const SAMPLES = args.indexOf('--samples') >= 0 ? Number(args[args.indexOf('--samples') + 1]) : 3;
const rootArg = args.indexOf('--root') >= 0 ? args[args.indexOf('--root') + 1] : null;
if (APPLY && CHECK) fail('Use either --apply or --check, not both.');

const here = path.dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, maxBuffer: 1 << 28 }).toString('utf8');
const ROOT = rootArg ? path.resolve(rootArg) : git(process.cwd(), 'rev-parse', '--show-toplevel').trim();

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------------------------
// Content rules. ORDER MATTERS: the first rule that matches a piece of text rewrites it, so no later rule sees it.
// kind: header | envvar | role | password | urn | identifier | lowercase | display.  review: also listed for a human look.
// ---------------------------------------------------------------------------------------------------------------
const rules = [
  { id: 'R01', kind: 'header', desc: 'HTTP headers X-MatterFlow-* (CSRF Client, View-As-Ended)', re: /X-MatterFlow-/g, to: 'X-LptHub-' },
  { id: 'R02', kind: 'envvar', desc: 'environment variables MATTERFLOW_* (MATTERFLOW_MIGRATE_ONLY)', re: /MATTERFLOW/g, to: 'LPTHUB' },
  { id: 'R03', kind: 'role', desc: 'database roles/logins mf_app, mf_migrator, mf_report_reader, mf_reports (and mf_migrator_login); keeps case',
    re: /\bmf_(app|migrator|report_reader|reports)(?=_login\b|(?![A-Za-z0-9_]))/gi,
    to: (m) => (m === m.toUpperCase() ? 'LPT_' : 'lpt_') + m.slice(3) },
  { id: 'R04', kind: 'password', desc: 'default dev passwords MatterFlow_Dev1! / _Reports1! / _Perf1!', re: /MatterFlow_(Dev1|Reports1|Perf1)/g, to: 'LptHub_$1' },
  { id: 'R05', kind: 'urn', desc: 'problem-details type URI urn:matterflow:error:*', re: /urn:matterflow:/g, to: 'urn:lpt-hub:' },
  { id: 'R07', kind: 'lowercase', desc: 'repository root line "MatterFlow/" in a folder tree', re: /^MatterFlow\/(?=\s|$)/gm, to: 'lpt-hub/' },
  { id: 'R10', kind: 'identifier', desc: 'database name in connection strings (Database=, Initial Catalog=, Application Name=)',
    re: /\b(Database|Initial Catalog|Application Name)=MatterFlow\b/g, to: '$1=LptHub' },
  { id: 'R11', kind: 'identifier', desc: 'connection-string key ConnectionStrings:MatterFlow / ConnectionStrings__MatterFlow', re: /ConnectionStrings(:|__)MatterFlow\b/g, to: 'ConnectionStrings$1LptHub' },
  { id: 'R12', kind: 'identifier', desc: 'connection-string key in code (GetConnectionString("..."), ConnectionStringName, ApplicationConnectionNames)',
    re: /(GetConnectionString\(|ConnectionStringName = |ApplicationConnectionNames = \[)"MatterFlow"/g, to: '$1"LptHub"' },
  { id: 'R13', kind: 'identifier', desc: 'JSON key "MatterFlow" / "_MatterFlow" (appsettings connection-string entry and its comment key)', re: /"(_?)MatterFlow"(?=\s*:\s*")/g, to: '"$1LptHub"' },
  { id: 'R14', kind: 'identifier', desc: 'database name in SQL / sqlcmd (DATABASE x, USE x, -d x, NAME=x, DB_ID(\'x\'), [x])',
    re: /(\bDATABASE |\bUSE |\s-d |\bNAME=)MatterFlow\b|(DB_ID\(')MatterFlow(')|\[MatterFlow\]/g,
    to: (m, a, b, c) => (a !== undefined ? a + 'LptHub' : b !== undefined ? b + 'LptHub' + c : '[LptHub]') },
  { id: 'R15', kind: 'identifier', desc: 'IIS site and app pool names (configure-iis.ps1 parameters, Start-/Stop-WebSite)',
    re: /(-SiteName |-AppPoolName |\$SiteName = '|\$AppPoolName = '|\b(?:Stop|Start|Restart|Get)-(?:WebSite|WebAppPool) )MatterFlow\b/g, to: '$1LptHub' },
  { id: 'R16', kind: 'identifier', desc: 'prose that names the database, IIS site or app pool in backticks (database `X`, empty `X`, pool `X`, site `X`, backup of `X`)',
    re: /\b((?:database(?: name)?|empty|pool|site|backup\*{0,2} of)\s+(?:\|\s+)?)`MatterFlow`/gi, to: '$1`LptHub`' },
  { id: 'R19', kind: 'identifier', desc: 'other technical string values: sqlcmd -d argument split over lines, name = \'x\' in SQL, database "x" in an error text, AddAuthentication("x")',
    re: /('-d',\s+)'MatterFlow'|(\bname = )'MatterFlow'|(\bdatabase )"MatterFlow"|(AddAuthentication\()"MatterFlow"/gi,
    to: (m, a, b, c, d) => (a ? a + "'LptHub'" : b ? b + "'LptHub'" : c ? c + '"LptHub"' : d + '"LptHub"') },
  { id: 'R17', kind: 'identifier', desc: 'identifier glued to other letters/underscore: MatterFlowDbContext, AddMatterFlowModules, FakeMatterFlow, __MatterFlow, MatterFlow_log',
    re: /MatterFlow(?=[A-Z_])|(?<=[A-Za-z0-9_])MatterFlow/g, to: 'LptHub' },
  { id: 'R18', kind: 'identifier', desc: 'dotted names: namespaces, assemblies, projects, MatterFlow.sln, MatterFlow.{module}, "MatterFlow."',
    re: /MatterFlow(?=\.[A-Za-z{*"'`])/g, to: 'LptHub' },
  { id: 'R20', kind: 'lowercase', desc: 'lowercase database name in connection strings (Initial Catalog=matterflow)', re: /\b(Database|Initial Catalog)=matterflow\b/g, to: '$1=lpthub' },
  { id: 'R21', kind: 'lowercase', desc: 'lowercase inside snake_case identifiers (a C# test name)', re: /\bmatterflow(?=_)|(?<=_)matterflow/g, to: 'lpt_hub' },
  { id: 'R22', kind: 'lowercase', desc: 'lowercase product slug: npm packages, container/volume, host names, URL host, gMSA, folder, artifact, repo', re: /matterflow/g, to: 'lpt-hub' },
  { id: 'R30', kind: 'display', desc: 'browser-title suffix " - MatterFlow"', re: / - MatterFlow\b/g, to: ' - LPT Hub' },
  { id: 'R31', kind: 'display', desc: 'quoted or backticked bare name ("MatterFlow", \'MatterFlow\', `MatterFlow`): display text, but could be a technical value', re: /(["'`])MatterFlow\1/g, to: '$1LPT Hub$1', review: true },
  { id: 'R32', kind: 'display', desc: 'every other occurrence: prose, comments, labels', re: /MatterFlow/g, to: 'LPT Hub' },
  { id: 'R33', kind: 'display', desc: 'article agreement after the rewrite: "a LPT Hub" -> "an LPT Hub"', re: /\b([Aa]) (LPT Hub)/g, to: (m, a, n) => a + 'n ' + n },
];

const expand = (to, a) => (typeof to === 'function' ? to(...a) : to.replace(/\$(\d)/g, (_, n) => a[Number(n)] ?? ''));

// ---------------------------------------------------------------------------------------------------------------
// Allow-list
// ---------------------------------------------------------------------------------------------------------------
function globToRegex(glob) {
  let r = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; r += '(?:.*/)?'; } else r += '.*';
    } else if (c === '*') r += '[^/]*';
    else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r + '$');
}
function loadAllowlist(file) {
  const out = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [g, ...reason] = line.split('|');
    let glob = g.trim();
    const negate = glob.startsWith('!');
    if (negate) glob = glob.slice(1).trim();
    out.push({ glob, negate, reason: reason.join('|').trim(), re: globToRegex(glob), hits: 0 });
  }
  return out;
}
const allowEntries = loadAllowlist(path.join(here, 'allowlist.txt'));
function allowed(p) {
  let result = null;
  for (const e of allowEntries) if (e.re.test(p)) result = e.negate ? null : e;
  if (result) result.hits++;
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------
const OLD = /MatterFlow/g;
const renamePath = (p) => p.replace(OLD, 'LptHub');
const lsFiles = git(ROOT, 'ls-files', '-s', '-z').split('\0').filter(Boolean).map((l) => {
  const tab = l.indexOf('\t');
  return { mode: l.slice(0, 6), p: l.slice(tab + 1) };
});

const decoder = new TextDecoder('utf-8', { fatal: true });
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) return { binary: true, buf };
  let bom = false;
  let b = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { bom = true; b = buf.subarray(3); }
  try { return { text: decoder.decode(b), bom, buf }; } catch { return { nonUtf8: true, buf }; }
}

// ---------------------------------------------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------------------------------------------
const OLD_ANY = /matterflow/i;
const OLD_ROLE = /\bmf_(app|migrator|report_reader|reports)(?=_login\b|(?![A-Za-z0-9_]))/i;
if (CHECK) {
  const bad = [];
  let scanned = 0;
  let skipped = 0;
  for (const f of lsFiles) {
    if (f.mode === '120000') continue;
    if (allowed(f.p)) { skipped++; continue; }
    scanned++;
    const hits = [];
    if (OLD_ANY.test(f.p)) hits.push('path: ' + f.p);
    const abs = path.join(ROOT, f.p);
    if (!fs.existsSync(abs)) continue;
    const t = readText(abs);
    if (t.binary || t.nonUtf8) {
      if (t.buf.toString('latin1').match(/matterflow/i)) hits.push('binary/non-UTF8 content contains the old name');
    } else {
      t.text.split(/\r?\n/).forEach((line, i) => {
        if (OLD_ANY.test(line) || OLD_ROLE.test(line)) hits.push(`${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    if (hits.length) bad.push({ p: f.p, hits });
  }
  console.log(`# Rename completeness check\n\nScanned ${scanned} files outside the allow-list (${skipped} allow-listed files skipped).`);
  if (!bad.length) { console.log('\nOK: the old name (MatterFlow in any case, and the old role names) appears nowhere outside the allow-list.'); process.exit(0); }
  const total = bad.reduce((n, b) => n + b.hits.length, 0);
  console.log(`\nFAIL: ${total} hit(s) in ${bad.length} file(s) outside the allow-list:\n`);
  for (const b of bad.slice(0, 200)) { console.log(`- ${b.p}`); for (const h of b.hits.slice(0, 3)) console.log(`    ${h}`); }
  if (bad.length > 200) console.log(`... and ${bad.length - 200} more files`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Plan: paths
// ---------------------------------------------------------------------------------------------------------------
if (APPLY && !FORCE) {
  const branch = git(ROOT, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (['dev', 'main', 'master'].includes(branch)) fail(`Refusing --apply on branch "${branch}" (use --force only with the owner's go-ahead).`);
  if (git(ROOT, 'status', '--porcelain').trim()) fail('Refusing --apply on a dirty working tree (commit or discard first, or use --force).');
}

const entries = lsFiles.map((f) => {
  const allow = allowed(f.p);
  const np = allow ? f.p : renamePath(f.p);
  return { ...f, allow, np };
});
// Unique path prefixes whose last component changes, shallow first.
const moves = new Map();
for (const e of entries) {
  if (e.allow || e.np === e.p) continue;
  const comps = e.p.split('/');
  for (let i = 0; i < comps.length; i++) {
    if (!comps[i].includes('MatterFlow')) continue;
    const old = comps.slice(0, i + 1).join('/');
    if (!moves.has(old)) moves.set(old, { depth: i, isDir: i < comps.length - 1, old });
  }
}
const moveList = [...moves.values()].sort((a, b) => a.depth - b.depth || a.old.localeCompare(b.old)).map((m) => {
  const comps = m.old.split('/');
  const cur = comps.map((c, i) => (i < comps.length - 1 ? renamePath(c) : c)).join('/');
  return { ...m, cur, nw: comps.map(renamePath).join('/') };
});
const dirMoves = moveList.filter((m) => m.isDir);
const fileMoves = moveList.filter((m) => !m.isDir);
const filesWithNewPath = entries.filter((e) => !e.allow && e.np !== e.p).length;

if (APPLY) {
  for (const m of moveList) {
    if (!fs.existsSync(path.join(ROOT, m.cur))) fail(`Missing source for git mv: ${m.cur}`);
    fs.mkdirSync(path.dirname(path.join(ROOT, m.nw)), { recursive: true });
    execFileSync('git', ['mv', m.cur, m.nw], { cwd: ROOT });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Plan: content
// ---------------------------------------------------------------------------------------------------------------
const stats = new Map(rules.map((r) => [r.id, { matches: 0, files: new Set(), samples: [], review: [] }]));
const skippedBinary = [];
const skippedNonUtf8 = [];
const skippedSymlink = [];
const uncovered = [];
const allowedWithMatches = new Map();
let filesChanged = 0;
let baseName = 0;
let baseNameFiles = 0;
let baseRoles = 0;

for (const e of entries) {
  if (e.mode === '120000') { if (/matterflow/i.test(e.p)) skippedSymlink.push(e.p); continue; }
  const abs = path.join(ROOT, APPLY ? e.np : e.p);
  if (!fs.existsSync(abs)) continue;
  const t = readText(abs);
  if (e.allow) {
    const probe = t.binary || t.nonUtf8 ? t.buf.toString('latin1') : t.text;
    const n = (probe.match(/matterflow/gi) || []).length + (OLD_ROLE.test(probe) ? 1 : 0);
    if (n) { const k = e.allow.glob; allowedWithMatches.set(k, (allowedWithMatches.get(k) || { n: 0, files: 0, reason: e.allow.reason }));
      allowedWithMatches.get(k).n += n; allowedWithMatches.get(k).files++; }
    continue;
  }
  if (t.binary || t.nonUtf8) {
    if (t.buf.toString('latin1').match(/matterflow/i)) (t.binary ? skippedBinary : skippedNonUtf8).push(e.p);
    continue;
  }
  let text = t.text;
  const before = text;
  const bn = (text.match(/matterflow/gi) || []).length;
  if (bn) { baseName += bn; baseNameFiles++; }
  baseRoles += (text.match(new RegExp(OLD_ROLE.source, 'gi')) || []).length;
  for (const r of rules) {
    r.re.lastIndex = 0;
    const st = stats.get(r.id);
    text = text.replace(r.re, (...a) => {
      const out = expand(r.to, a);
      st.matches++;
      st.files.add(e.p);
      const offset = a[a.length - 2];
      const line = (text.slice(0, offset).match(/\n/g) || []).length + 1;
      const rec = `${e.p}:${line}`;
      if (st.samples.length < SAMPLES) st.samples.push(`${rec}  ${a[0]} -> ${out}`);
      if (r.review || LIST_ALL) st.review.push(rec);
      return out;
    });
  }
  if (text !== before) {
    filesChanged++;
    if (APPLY) fs.writeFileSync(abs, Buffer.concat([t.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')]));
  }
  if (/matterflow/i.test(text) || OLD_ROLE.test(text)) uncovered.push(e.p);
}

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------
const totalMatches = [...stats.values()].reduce((n, s) => n + s.matches, 0);
const L = [];
L.push(`# Rename ${APPLY ? 'APPLY' : 'dry run'}: MatterFlow -> LPT Hub`);
L.push('');
L.push(`Tracked files: ${lsFiles.length}. Allow-listed files: ${entries.filter((e) => e.allow).length}.`);
L.push('');
L.push(`Baseline outside the allow-list: ${baseName} occurrences of the product name (any case) in ${baseNameFiles} files, plus ${baseRoles} old database role names. Rules R01-R32 below rewrite ${totalMatches - stats.get('R33').matches - stats.get('R03').matches} name matches (must equal the first number) and ${stats.get('R03').matches} role names.`);
L.push('');
L.push('## Paths (git mv)');
L.push('');
L.push(`- Folders to move: ${dirMoves.length}`);
L.push(`- Files whose own name changes (after their folder moved): ${fileMoves.length}`);
L.push(`- Tracked files whose path changes in total: ${filesWithNewPath}`);
L.push('');
L.push('## Content rules');
L.push('');
L.push('| Rule | Kind | Matches | Files | Meaning |');
L.push('|---|---|---:|---:|---|');
for (const r of rules) {
  const s = stats.get(r.id);
  L.push(`| ${r.id}${r.review ? ' (review)' : ''} | ${r.kind} | ${s.matches} | ${s.files.size} | ${r.desc.replace(/\|/g, '\\|')} |`);
}
L.push(`| | | **${totalMatches}** | **${filesChanged}** | total matches / files changed |`);
L.push('');
L.push('Kinds: ' + [...new Set(rules.map((r) => r.kind))].map((k) => {
  const rs = rules.filter((r) => r.kind === k);
  return `${k} ${rs.reduce((n, r) => n + stats.get(r.id).matches, 0)}`;
}).join(', ') + '.');
L.push('');
L.push(`## Samples (first ${SAMPLES} per rule)`);
L.push('');
for (const r of rules) { const s = stats.get(r.id); if (s.samples.length) { L.push(`- ${r.id}`); for (const x of s.samples) L.push(`  - \`${x.replace(/`/g, "'")}\``); } }
L.push('');
L.push('## Needs a human look (rule R31: quoted bare name rewritten as display text)');
L.push('');
const r31 = stats.get('R31').review;
const byFile = new Map();
for (const rec of r31) { const f = rec.slice(0, rec.lastIndexOf(':')); byFile.set(f, (byFile.get(f) || 0) + 1); }
L.push(`${r31.length} occurrence(s) in ${byFile.size} file(s).`);
L.push('');
if (LIST_REVIEW) for (const rec of r31) L.push(`- ${rec}`);
else for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) L.push(`- ${f}: ${n}`);
L.push('');
L.push('## Allow-listed files that still contain the old name (left untouched)');
L.push('');
if (!allowedWithMatches.size) L.push('None.');
for (const [g, v] of allowedWithMatches) L.push(`- \`${g}\`: ${v.n} occurrence(s) in ${v.files} file(s) - ${v.reason}`);
L.push('');
L.push('## Not rewritten (binary, not UTF-8, symbolic link) and outside the allow-list');
L.push('');
const notRewritten = [...skippedBinary, ...skippedNonUtf8, ...skippedSymlink];
if (!notRewritten.length) L.push('None.');
for (const p of notRewritten) L.push(`- ${p}`);
L.push('');
L.push("## Files matching 'matterflow' (any case) or an old role name that NO rule covers");
L.push('');
if (!uncovered.length && !notRewritten.length) L.push('None: every match is covered by a rule or by the allow-list.');
else { for (const p of uncovered) L.push(`- ${p} (still matches after all rules)`); for (const p of notRewritten) L.push(`- ${p} (not rewritten, see above)`); }
console.log(L.join('\n'));
if (APPLY) console.error('\nApplied. Next: node tools/rename/rename.mjs --check');
