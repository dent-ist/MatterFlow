/* Matter one-page mockup: tiny renderer. No framework, no network, nothing saves. Used by index.html (the one page) and full-view.html (the existing tab page).
   URL options: ?chrome=0 hides the mockup guide; ?load=normal|hold|fail; ?prod=empty|data; ?viewer=full|limited; ?rows=5|10|15; #tasks (or any section id) scrolls there. */
(function () {
  const D = window.D, M = D.matter;
  const Q = new URLSearchParams(location.search);
  const FULL = document.body.classList.contains('full');
  const S = { load: Q.get('load') || 'normal', prod: Q.get('prod') || 'empty', viewer: Q.get('viewer') || 'full', rows: +(Q.get('rows') || 10), guide: false, coll: {} };
  if (Q.get('chrome') === '0') document.body.classList.add('nochrome');
  const $root = document.getElementById('root');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ic = (n, c) => '<i class="pi pi-' + n + (c ? ' ' + c : '') + '" aria-hidden="true"></i>';
  const num = (n) => n.toLocaleString('en-US');
  const person = (id) => D.people[id];
  const av = (id, sm) => '<span class="avatar ' + (person(id).k === 'External' ? 'avatar--ext ' : '') + (sm ? 'avatar--sm' : '') + '" aria-hidden="true">' + person(id).i + '</span>';
  const who = (id) => '<span class="cells-person">' + av(id) + '<span class="nowrap" style="overflow:hidden;text-overflow:ellipsis">' + esc(person(id).n) + '</span></span>';

  /* ---------- section definitions: order = today's tab order (matter-tabs.ts) ---------- */
  const STATUS = { new: ['New', 'circle'], progress: ['In Progress', 'play'], hold: ['On Hold', 'pause'], done: ['Completed', 'check'], cancel: ['Cancelled', 'times'] };
  const chipSt = (k) => '<span class="st st--' + k + '">' + ic(STATUS[k][1]) + STATUS[k][0] + '</span>';
  const ttCell = (k) => { const t = D.TT[k]; return '<span class="tt-cell"><span class="tile" style="background:var(--mf-tt-' + t[2] + ')">' + ic(t[1]) + '</span><span class="nm" title="' + t[0] + '">' + t[0] + '</span></span>'; };
  const priCell = (p) => p === 'Critical' ? '<span class="pri pri--crit">' + ic('flag-fill') + 'Critical</span>' : p === 'High' ? '<span class="pri pri--high">' + ic('flag') + 'High</span>' : p;
  const dueCell = (t) => { const late = t.due < 0; const d = Math.abs(t.due); return '<span class="' + (late ? 'late' : '') + '" title="' + (late ? 'Overdue by ' + d + (d === 1 ? ' day' : ' days') : '') + '">' + D.md(t.due) + ' ' + t.time + '</span>' + (late ? '<span class="latew">-' + d + 'd</span>' : ''); };
  const tagChip = (t) => '<span class="tag" style="background:var(--mf-tag-' + t[1] + '-bg);color:var(--mf-tag-' + t[1] + '-fg)">' + t[0] + '</span>';

  const SECS = [
    { id: 'summary', label: 'Summary', icon: 'home' },
    { id: 'tasks', label: 'Tasks', icon: 'check-square', count: () => D.counts.tasks, noun: 'tasks', hint: 'Open tasks, earliest due first', perm: '', data: () => D.tasks.filter((t) => t.status !== 'done'),
      cols: [['Ref', '100px', (t) => '<a class="mf-link ref" href="#" data-dead="1">' + t.ref + '</a>'], ['Type', '128px', (t) => ttCell(t.type)], ['Title', '', (t) => '<a class="nmlink" href="#" data-dead="1" title="' + esc(t.title) + '">' + esc(t.title) + '</a>'], ['Priority', '112px', (t) => priCell(t.pri)], ['Assignee', '140px', (t) => who(t.who)], ['Due', '168px', dueCell], ['Status', '140px', (t) => chipSt(t.status)]] },
    { id: 'projects', label: 'Projects', icon: 'folder', count: () => D.counts.projects, noun: 'projects', hint: 'Projects group the tasks of this matter', perm: 'Project.View', data: () => D.projects,
      cols: [['Name', '', (p) => '<a class="nmlink" href="#" data-dead="1">' + esc(p.n) + '</a>'], ['Open Tasks', '112px', (p) => p.open, 'num'], ['Overdue', '96px', (p) => p.late ? '<span class="late">' + p.late + '</span>' : '0', 'num'], ['Status', '140px', (p) => p.status === 'Active' ? '<span class="st st--progress">' + ic('play') + 'Active</span>' : '<span class="st st--cancel">' + ic('inbox') + 'Archived</span>']] },
    { id: 'assets', label: 'Assets', icon: 'database', count: () => D.counts.assets, noun: 'assets', hint: 'Evidence and data sources', perm: 'Asset.View', data: () => D.assets,
      cols: [['Type', '152px', (a) => '<span class="tt-cell"><span class="tile" style="background:var(--mf-tt-' + a.type[2] + ')">' + ic(a.type[1]) + '</span><span class="nm">' + a.type[0] + '</span></span>'], ['Name', '', (a) => '<a class="nmlink" href="#" data-dead="1" title="' + esc(a.n) + '">' + esc(a.n) + '</a>'], ['Size', '96px', (a) => a.size, 'num'], ['Linked Tasks', '112px', (a) => a.linked, 'num'], ['External Reference', '176px', (a) => a.ext ? '<span class="mono">' + a.ext + '</span>' : '<span class="muted">None</span>'], ['Disposition', '168px', (a) => a.disp]] },
    { id: 'productions', label: 'Productions', icon: 'send', count: () => (S.prod === 'data' ? 3 : 0), noun: 'productions', hint: 'What is sent to and received from other parties', perm: 'Production.View', data: () => S.prod === 'data' ? D.prodData : [],
      cols: [['Production', '', (p) => '<a class="nmlink" href="#" data-dead="1" title="' + esc(p.n) + '">' + esc(p.n) + '</a>'], ['Direction and Party', '208px', (p) => esc(p.dir)], ['Bates Range', '246px', (p) => '<span class="mono">' + p.bates + '</span>'], ['Documents', '104px', (p) => num(p.docs), 'num'], ['Delivered or Due', '176px', (p) => p.due]],
      empty: ['send', 'No productions yet.', 'A production records the documents you send to or receive from another party, with its Bates range and format.', 'New Production'] },
    { id: 'notes', label: 'Notes', icon: 'file-edit', count: () => D.counts.notes, noun: 'notes', hint: 'Most recently updated first', perm: 'MatterNote.View', data: () => D.notes,
      cols: [['Title', '', (n) => '<a class="nmlink" href="#" data-dead="1">' + esc(n.t) + '</a>'], ['Tags', '144px', (n) => tagChip(n.tag)], ['Author', '176px', (n) => who(n.who)], ['Last Updated', '152px', (n) => n.upd]] },
    { id: 'activities', label: 'Activities', icon: 'history', noun: 'activities', hint: 'Newest first', perm: 'Audit.View', total: () => D.counts.activities, data: () => D.activities,
      cols: [['When', '124px', (a) => a.when], ['What', '', (a) => '<span title="' + esc(a.what) + '">' + esc(a.what) + '</span>'], ['Who', '176px', (a) => who(a.who)]] }
  ];
  const allowed = (s) => S.viewer === 'full' || !(s.perm === 'Asset.View' || s.perm === 'Audit.View');
  const secs = () => SECS.filter(allowed);
  const st = {}; /* id -> idle | loading | ready | error */
  const fullHref = (id) => 'full-view.html?tab=' + id;

  /* ---------- section bodies ---------- */
  function thead(s) { return '<colgroup>' + s.cols.map((c) => '<col' + (c[1] ? ' style="width:' + c[1] + '"' : '') + '>').join('') + '</colgroup><thead><tr>' + s.cols.map((c) => '<th class="' + (c[3] || '') + '"' + (c[1] ? ' style="width:' + c[1] + '"' : '') + '>' + c[0] + '</th>').join('') + '</tr></thead>'; }
  function skRows(s, n) {
    let r = '';
    for (let i = 0; i < n; i++) r += '<tr>' + s.cols.map((c, j) => '<td><span class="sk ' + (c[0] === 'Status' || c[0] === 'Priority' ? 'sk--chip' : '') + '" style="width:' + (c[1] ? Math.min(parseInt(c[1]) - 28, 40 + ((i * 17 + j * 29) % 50)) + 'px' : (45 + ((i * 13) % 40)) + '%') + '"></span></td>').join('') + '</tr>';
    return r;
  }
  function secBody(s) {
    const state = st[s.id];
    const rowsN = FULL ? 25 : S.rows;
    if (state === 'idle' || state === 'loading') {
      return '<div class="sec-body" aria-busy="true"><table>' + thead(s) + '<tbody>' + skRows(s, rowsN) + '</tbody></table></div>' +
        '<div class="sec-f" role="status"><span class="sk-note">' + (state === 'loading' ? ic('spinner', 'pi-spin') + 'Loading ' + s.noun + '...' : ic('clock') + s.label + ' loads when you scroll here') + '</span></div>';
    }
    if (state === 'error') {
      return '<div class="sec-body"><table>' + thead(s) + '</table><div class="sec-state" role="alert">' + ic('exclamation-triangle') + '<p>Couldn\'t load ' + s.noun + '.</p><small>The server did not answer. The other sections are not affected.</small><button class="btn" data-a="retry|' + s.id + '">' + ic('refresh') + 'Retry</button></div></div>' +
        '<div class="sec-f"><span class="sp"></span><a class="btn btn--text" href="' + fullHref(s.id) + '">Open Full View' + ic('arrow-right') + '</a></div>';
    }
    const all = s.data(); const total = s.total ? s.total() : (s.count ? s.count() : all.length);
    if (!all.length) {
      const e = s.empty;
      return '<div class="sec-body"><table>' + thead(s) + '</table><div class="sec-state">' + ic(e[0]) + '<p>' + e[1] + '</p><small>' + e[2] + '</small><button class="btn btn--primary">' + ic('plus') + e[3] + '</button></div></div>' +
        '<div class="sec-f"><span>0 ' + s.noun + '</span><span class="sp"></span><a class="btn btn--text" href="' + fullHref(s.id) + '">Open Full View' + ic('arrow-right') + '</a></div>';
    }
    const shown = all.slice(0, rowsN);
    const body = shown.map((r) => '<tr>' + s.cols.map((c) => '<td class="' + (c[3] || '') + '">' + c[2](r) + '</td>').join('') + '</tr>').join('');
    const note = FULL ? '1-' + shown.length + ' of ' + num(total) : (total > shown.length ? 'Showing ' + shown.length + ' of ' + num(total) + ' ' + s.noun : 'Showing all ' + total + ' ' + s.noun);
    return '<div class="sec-body"><table>' + thead(s) + '<tbody>' + body + '</tbody></table></div>' +
      (FULL ? '' : '<div class="sec-f"><span>' + note + '</span><span class="sp"></span><a class="btn btn--text" href="' + fullHref(s.id) + '">Open Full View' + ic('arrow-right') + '</a></div>');
  }
  function secCard(s) {
    const cnt = s.count ? '<span class="cnt">' + num(s.count()) + '</span>' : '';
    return '<section class="osec" id="' + s.id + '" aria-labelledby="h-' + s.id + '" data-sec="' + s.id + '"><div class="sec-h">' + ic(s.icon) + '<h2 id="h-' + s.id + '">' + s.label + '</h2>' + cnt + '<span class="hint">' + s.hint + '</span></div><div data-body="' + s.id + '">' + secBody(s) + '</div></section>';
  }

  /* ---------- Summary section: as today (tiles, Details, side column with Team and Vendors) ---------- */
  function panel(key, title, n, extra, edit, rows, footer, emptyHtml) {
    const open = !S.coll[key];
    if (!n) return '<section class="card pnl pnl-empty" aria-label="' + title + '"><span class="pnl-t">' + title + '</span><span class="cnt">0</span>' + emptyHtml + '</section>';
    return '<section class="card pnl" aria-label="' + title + '"><div class="pnl-h"><button class="pnl-tg" aria-expanded="' + open + '" data-a="coll|' + key + '" aria-label="' + (open ? 'Collapse ' : 'Expand ') + title + '">' + ic(open ? 'chevron-down' : 'chevron-right') + '<span class="pnl-t">' + title + '</span><span class="cnt">' + n + '</span>' + (extra || '') + '</button>' + edit + '</div>' + (open ? '<ul class="bx-list">' + rows + '</ul>' + (footer || '') : '') + '</section>';
  }
  const kindChip = (k) => '<span class="chip bx-chip ' + (k === 'External' ? '' : 'chip--info') + '">' + ic(k === 'External' ? 'globe' : k === 'Internal' ? 'building' : 'user') + k + '</span>';
  function summary() {
    const cap = innerHeight >= 1000 ? 5 : 4;
    const tm = D.team.slice(0, cap).map((id) => '<li class="pl-row">' + av(id, true) + '<span class="pl-tx"><b>' + esc(person(id).n) + '</b><span class="pl-sub">' + esc(person(id).t) + '</span></span>' + kindChip(person(id).k) + '</li>').join('');
    const vn = D.vendors.slice(0, cap).map((v) => '<li class="pl-row pl-v"><span class="bx-main"><button class="btn btn--name" data-dead="1">' + esc(v.n) + '</button></span>' + (v.flag ? '<span style="color:var(--mf-danger)" title="A contact is flagged Do Not Hire">' + ic('flag') + '</span>' : '') + '<span class="chip bx-chip">' + v.cat + '</span></li>').join('');
    const f = (l, v, wide) => '<div class="df ' + (wide ? 'wide' : '') + '"><span class="dl">' + l + '</span><span class="dv">' + v + '</span></div>';
    const pr = M.pm, sc = M.sec;
    return '<div class="sumwrap"><ul class="ms-tiles">' + D.assetTiles.map((t) => '<li class="card ms-tile"><span class="tt" style="background:var(--mf-tt-' + t[2] + ')">' + ic(t[1]) + '</span><span class="nm">' + t[0] + '</span><span class="ct">' + t[3] + '</span></li>').join('') + '</ul>' +
      '<div class="sumgrid"><div class="card ms-details"><div class="bx-h"><h3>Details</h3></div><div class="ms-fields">' +
      f('CM Number', '<span class="ms-cm">' + M.cm + '</span>') + f('Client', '<a class="link mono" href="#" data-dead="1">' + M.cno + '</a> ' + esc(M.client)) + f('Matter Number', '<span class="mono">' + M.mno + '</span>') + f('Matter Name', esc(M.name)) +
      f('Matter Type', '<span class="tag">' + M.type + '</span>') + f('Matter Category', M.category) + f('Current State', M.state) + f('Status', '<span class="chip chip--ok">' + ic('check-circle') + 'Active</span>') +
      f('Primary PM', av(pr, true) + ' ' + esc(person(pr).n)) + f('Secondary PM', av(sc, true) + ' ' + esc(person(sc).n)) + f('AI Allowed', '<span class="chip">' + ic('sparkles') + 'Yes</span>') + f('Created', M.created) +
      f('DMS Path', '<span class="mono">\\\\fs01\\dms\\Matters\\' + M.cno + '\\' + M.mno + '</span> <button class="btn btn--text" data-dead="1">Copy</button>', 1) + f('DFS Path', '<span class="mono">https://dfs.example.com/matters/' + M.cno + '/' + M.mno + '</span> <button class="btn btn--text" data-dead="1">Copy</button>', 1) +
      '</div></div><div class="side">' +
      panel('team', 'Team', D.team.length, '', '<button class="btn btn--text" data-dead="1">' + ic('pencil') + 'Edit</button>', tm, D.team.length > cap ? '<div class="bx-f"><button class="btn btn--text" data-dead="1">Show All ' + D.team.length + '</button></div>' : '', '') +
      panel('vendors', 'Vendors', D.vendors.length, '<span class="chip chip--bad bx-chip" title="A linked vendor has a contact flagged Do Not Hire">' + ic('flag') + '1</span>', '<button class="btn btn--text" data-dead="1">' + ic('pencil') + 'Edit</button>', vn, D.vendors.length > cap ? '<div class="bx-f"><button class="btn btn--text" data-dead="1">Show All ' + D.vendors.length + '</button></div>' : '', '') +
      '</div></div></div>';
  }

  /* ---------- page frame ---------- */
  function nav() {
    const a = (icon, label, on, cls) => '<a href="#" data-dead="1" class="' + (cls || '') + '"' + (on ? ' aria-current="page"' : '') + '>' + ic(icon) + label + '</a>';
    return '<nav class="nav" aria-label="Main"><div class="logo"><i>LH</i>LPT Hub</div>' + a('chart-bar', 'Dashboard') + a('briefcase', 'My Matters') + a('list-check', 'My Work') + a('building', 'Clients') + a('folder', 'Matters', 1) + a('sitemap', 'Projects', 0, 'sub') + a('database', 'Assets', 0, 'sub') + a('address-book', 'People') + a('users', 'Pod Work') + a('list', 'Task Queue') +
      '<div class="sec">Administration</div>' + a('users', 'Users') + a('sliders-h', 'Task Types') + a('list', 'Lists') + a('database', 'Asset Types') + a('cog', 'Settings') + '</nav>';
  }
  const top = () => '<header class="top"><div class="gs">' + ic('search') + 'Search clients, matters, tasks, assets...<kbd>Ctrl+K</kbd></div><span class="sp"></span><button class="btn btn--primary" data-dead="1">' + ic('plus') + 'New Task</button><button class="btn btn--icon" aria-label="Notifications" data-dead="1">' + ic('bell') + '</button><span class="avatar" title="Priya Raman">PR</span></header>';
  const tabDef = (s) => '<a class="tab" href="#' + s.id + '" data-j="' + s.id + '">' + ic(s.icon) + s.label + (s.count ? ' <span class="ct">(' + num(s.count()) + ')</span>' : '') + '</a>';
  function header() {
    return '<nav class="crumb" aria-label="Breadcrumb"><a href="#" data-dead="1">Matters</a>' + ic('chevron-right', 'xs') + '<span class="cur">' + M.cm + '</span></nav>' +
      '<div class="ph"><span class="tile">' + ic('briefcase') + '</span><h1>' + esc(M.client) + '<span class="sepc"> &gt; </span>' + esc(M.name) + '</h1><span class="chip chip--ok">' + ic('check-circle') + 'Active</span><span class="sp"></span><button class="btn" data-dead="1">' + ic('pencil') + 'Edit</button><button class="btn" data-dead="1">Create' + ic('chevron-down') + '</button><button class="btn" data-dead="1">More Actions' + ic('chevron-down') + '</button></div>';
  }
  function page() {
    const list = secs();
    let h = '<main class="main" id="main"><div class="page">' + header();
    h += '<div class="jump" id="jump"><nav aria-label="Matter sections">' + list.map(tabDef).join('') + '</nav><span class="who"><span class="nm">' + esc(M.name) + '</span><b>' + M.cm + '</b></span></div>';
    h += '<section class="sec-anchor" id="summary" aria-labelledby="h-summary"><h2 class="sr" id="h-summary">Summary</h2>' + summary() + '</section>';
    h += list.filter((s) => s.id !== 'summary').map(secCard).join('');
    return h + '</div></main>';
  }
  const TABS_FULL = (cur) => '<div class="tabs" role="navigation" aria-label="Matter sections">' + secs().map((s) => '<a class="tab" ' + (s.id === 'summary' ? 'href="index.html#summary"' : 'href="' + fullHref(s.id) + '"') + (s.id === cur ? ' aria-selected="true" aria-current="page"' : '') + '>' + ic(s.icon) + s.label + (s.count ? ' <span class="ct">(' + num(s.count()) + ')</span>' : '') + '</a>').join('') + '</div>';
  function fullPage() {
    const tab = Q.get('tab') || 'tasks'; const s = SECS.find((x) => x.id === tab && allowed(x)) || SECS[1];
    st[s.id] = 'ready';
    return '<main class="main" id="main"><div class="page" style="gap:var(--mf-s3)">' + header() + TABS_FULL(s.id) +
      '<div class="toolbar"><div class="search">' + ic('search') + '<input type="text" placeholder="Search ' + s.noun + '" aria-label="Search ' + s.noun + '"></div><span class="dd"><button>' + '<span class="pre">Status:</span> All' + ic('chevron-down') + '</button></span><span class="sp"></span>' + (s.id === 'tasks' || s.id === 'notes' || s.id === 'productions' ? '<button class="btn btn--primary" data-dead="1">' + ic('plus') + 'New ' + { tasks: 'Task', notes: 'Note', productions: 'Production' }[s.id] + '</button>' : '') + '</div>' +
      '<div class="fv-frame osec">' + '<div data-body="' + s.id + '">' + secBody(s) + '</div><div class="pager"><span>' + (s.data().length ? '1-' + Math.min(25, s.data().length) + ' of ' + num(s.total ? s.total() : (s.count ? s.count() : s.data().length)) : '0 ' + s.noun) + '</span><span class="sp"></span><span class="pg">Rows <b>25</b> ' + ic('chevron-down') + '</span></div></div></div></main>';
  }

  /* ---------- mockup guide (not product) ---------- */
  function guide() {
    const L = (h, t) => '<a href="' + h + '">' + t + '</a>';
    const sel = (id, v, opts) => '<select data-s="' + id + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
    return '<button class="mk-pill" data-a="guide" aria-expanded="' + S.guide + '">' + ic('book') + 'Mockup Guide</button><div class="mk-badge">Mockup: no app code, nothing saves</div>' +
      (S.guide ? '<div class="mk-panel" role="dialog" aria-label="Mockup guide"><h2>One continuous matter page</h2><p>Issue #1396, epic #1389. Scroll the page; the strip under the title stays and follows you. Sizes: 1366x768 and 1920x1080.</p>' +
        '<h3>Jump to</h3>' + secs().map((s) => L('#' + s.id, s.label)).join('') +
        '<h3>Try</h3><label>Loading behaviour</label>' + sel('load', S.load, [['normal', 'Normal: each section loads when near the screen'], ['hold', 'Hold: placeholders stay (see the loading state)'], ['fail', 'Notes fails to load (error state)']]) +
        '<label>Productions</label>' + sel('prod', S.prod, [['empty', 'None yet (empty state)'], ['data', '3 productions']]) +
        '<label>Rows per section</label>' + sel('rows', S.rows, [[5, '5 rows'], [10, '10 rows (proposed)'], [15, '15 rows']]) +
        '<label>Who is looking</label>' + sel('viewer', S.viewer, [['full', 'Project Manager (all sections)'], ['limited', 'No Asset or Audit rights (two sections and tabs absent)']]) +
        '<div class="row" style="margin-top:8px"><button class="btn" data-a="reload">' + ic('refresh') + 'Reload Sections</button></div>' +
        '<hr><h3>Open Full View goes to</h3>' + L('full-view.html?tab=tasks', 'Tasks, full view (today\'s tab page)') + L('full-view.html?tab=productions', 'Productions, full view') +
        '<hr><p>Links marked as dead links (names, Edit, Create) do nothing in the mockup. No keyboard shortcut is added or changed (#420).</p></div>' : '');
  }

  /* ---------- lazy loading ---------- */
  let io = null; const timers = {};
  function setState(id, v) { st[id] = v; const el = document.querySelector('[data-body="' + id + '"]'); const s = SECS.find((x) => x.id === id); if (el && s) el.innerHTML = secBody(s); }
  function startLoad(id) {
    if (st[id] !== 'idle') return;
    if (S.load === 'hold') { setState(id, 'loading'); return; }
    setState(id, 'loading');
    timers[id] = setTimeout(() => setState(id, S.load === 'fail' && id === 'notes' && !S.retried ? 'error' : 'ready'), id === 'tasks' ? 700 : 900 + Math.random() * 500);
  }
  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { startLoad(e.target.getAttribute('data-sec')); io.unobserve(e.target); } }), { root: document.getElementById('main'), rootMargin: '0px 0px 300px 0px' });
    document.querySelectorAll('[data-sec]').forEach((el) => io.observe(el));
  }

  /* ---------- sticky strip: stuck look + current section ---------- */
  function spy() {
    const main = document.getElementById('main'), jump = document.getElementById('jump'); if (!main || !jump) return;
    const mt = main.getBoundingClientRect().top, jh = jump.offsetHeight;
    jump.classList.toggle('stuck', jump.getBoundingClientRect().top <= mt + 1);
    const ids = secs().map((s) => s.id); let cur = ids[0];
    ids.forEach((id) => { const a = document.getElementById(id); if (a && a.getBoundingClientRect().top - mt <= jh + 24) cur = id; });
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) cur = ids[ids.length - 1];
    jump.querySelectorAll('[data-j]').forEach((a) => { if (a.getAttribute('data-j') === cur) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    S.cur = cur;
  }

  /* ---------- render + events ---------- */
  function render(keepScroll) {
    const main = document.getElementById('main'); const y = main ? main.scrollTop : 0;
    secs().forEach((s) => { st[s.id] = st[s.id] || (s.id === 'summary' ? 'ready' : 'idle'); });
    $root.innerHTML = '<div class="app">' + nav() + top() + (FULL ? fullPage() : page()) + '</div>' + guide();
    const m = document.getElementById('main');
    if (!FULL) { observe(); m.addEventListener('scroll', () => { if (!S.raf) S.raf = requestAnimationFrame(() => { S.raf = 0; spy(); }); }); }
    if (keepScroll && m) { m.style.scrollBehavior = 'auto'; m.scrollTop = y; m.style.scrollBehavior = ''; }
    spy();
  }
  function resetSections() { Object.keys(timers).forEach((k) => clearTimeout(timers[k])); Object.keys(st).forEach((k) => delete st[k]); S.retried = false; }
  const acts = {
    guide: () => { S.guide = !S.guide; },
    reload: () => { resetSections(); },
    coll: (k) => { S.coll[k] = !S.coll[k]; },
    retry: (id) => { S.retried = true; st[id] = 'idle'; setState(id, 'loading'); timers[id] = setTimeout(() => setState(id, 'ready'), 900); }
  };
  document.addEventListener('click', (e) => {
    const j = e.target.closest('[data-j]');
    if (j) { e.preventDefault(); const a = document.getElementById(j.getAttribute('data-j')); if (a) a.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); return; }
    if (e.target.closest('.mk-panel a[href^="#"]')) { const h = e.target.closest('a').getAttribute('href').slice(1); e.preventDefault(); const a = document.getElementById(h); if (a) a.scrollIntoView({ behavior: 'auto', block: 'start' }); return; }
    if (e.target.closest('[data-dead]')) { e.preventDefault(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const [a, ...args] = b.getAttribute('data-a').split('|');
    if (acts[a]) { e.preventDefault(); const needFull = a === 'reload'; acts[a](...args); if (a === 'retry') return; render(!needFull); if (needFull) { const m = document.getElementById('main'); m.scrollTop = 0; } }
  });
  document.addEventListener('change', (e) => {
    const k = e.target.getAttribute && e.target.getAttribute('data-s'); if (!k) return;
    S[k] = k === 'rows' ? +e.target.value : e.target.value; resetSections(); S.guide = true; render(true);
  });
  addEventListener('resize', () => render(true));
  render(false);
  if (!FULL && location.hash.length > 1) {
    const a = document.getElementById(location.hash.slice(1)); const main = document.getElementById('main');
    if (a) { main.style.scrollBehavior = 'auto'; a.scrollIntoView({ block: 'start' }); main.style.scrollBehavior = ''; spy(); }
  }
})();
