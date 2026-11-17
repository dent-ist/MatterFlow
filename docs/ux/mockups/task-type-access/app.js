/* Task Type access mockup (#1402, epic #1397): Administration > Task Types (list, record page, Access tab), Roles and Audit Logs. Tiny renderer, no framework, no network, nothing saves, no app code.
   URL options (all optional, combine with &):
     ?view=list|record|new|roles|audit      screen (default list)
     ?id=3&tab=access|overview|workflows|form   Task Type record (default Privilege Review, Access tab)
     ?placement=tab|section                 Access as its own tab (recommended, default) or as a section of Overview
     ?enforced=0|1                          feature switch Features:TaskTypeAccess (default 1 = on; 0 = rules saved but not enforced)
     ?viewer=manager|sysadmin               Operations Admin who can manage Task Types | System Admin (cannot lose access)
     ?scene=normal|allopen|empty|loading|error   starting data of the list
     ?filter=restricted|inactive|...        a strip chip on the list
     ?state=ready|loading|error|stale|saveerror|fielderror   state of the Access tab
     ?draft=view:1,4,7|edit:1,7|assign:1,4  unsaved choices already made in the Access tab
     ?menu=view|edit|assign                 open one role multi-select (audit: ?menu=event)
     ?dialog=confirm|delete                 open a dialog; ?preview=auto|hide|open|lose|all|loading|error|notenforced picks the preview the confirm shows
     ?tip=access|summary|chip               force a tooltip to show
     ?error=1&usedby=1|3                    Roles: the 409 after Delete Role
     ?chrome=0 hides the mockup guide, ?guide=1 opens it. */
(function () {
  const D = window.D;
  const Q = new URLSearchParams(location.search);
  const $root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ic = (n, c) => '<i class="pi pi-' + n + (c ? ' ' + c : '') + '" aria-hidden="true"></i>';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const plural = (n, w, pl) => n + ' ' + (n === 1 ? w : (pl || w + 's'));
  const uniq = (a) => Array.from(new Set(a));
  if (Q.get('chrome') === '0') document.body.classList.add('nochrome');
  const roleOf = (id) => D.ROLES.find((r) => r.id === id);
  const rname = (id) => (roleOf(id) ? roleOf(id).name : 'Role ' + id);
  const byName = (ids) => ids.slice().sort((a, b) => rname(a).localeCompare(rname(b), undefined, { sensitivity: 'base' }));
  const listText = (ids) => byName(ids).map(rname).join(', ');

  /* ---------- state ---------- */
  const parseDraft = (s) => {
    if (!s) return null; const a = { view: [], edit: [], assign: [] };
    s.split('|').forEach((p) => { const [k, v] = p.split(':'); if (a[k] && v) a[k] = v.split(',').map(Number).filter(Boolean); });
    return a;
  };
  const S = {
    view: Q.get('view') || 'list', id: +(Q.get('id') || 3), tab: Q.get('tab') || 'access', placement: Q.get('placement') || 'tab',
    enforced: Q.get('enforced') !== '0', viewer: Q.get('viewer') || 'manager', scene: Q.get('scene') || 'normal', filter: Q.get('filter') || '',
    state: Q.get('state') || 'ready', menu: Q.get('menu') || null, dlg: Q.get('dialog') || null, pvKind: Q.get('preview') || 'auto', guide: Q.get('guide') === '1',
    toasts: [], nextId: 1, sort: { key: 'name', dir: 'asc' }, f: { name: '', form: '', access: '', status: 'active' }, rolesError: Q.get('error') === '1', usedBy: Q.get('usedby') || '1',
    pv: null, pvState: 'ready', busy: false, rolesSel: 9, fieldErr: null, conflict: false, menuAt: null,
  };
  let TYPES = clone(D.TYPES);
  let DRAFT = null; /* the unsaved lists of the open record (view = explicit Can View roles), null when nothing was touched */
  const viewer = () => D.VIEWERS[S.viewer] || D.VIEWERS.manager;
  const cur = () => (S.view === 'new' ? NEWTYPE : TYPES.find((t) => t.id === S.id) || TYPES[0]);
  const NEWTYPE = { id: 0, name: '', icon: 'tag', colour: 'blue', wf: '', wfMore: 0, target: null, form: 'No form', formV: '', workflows: 0, open: 0, active: true, usable: false, access: { view: [], edit: [], assign: [] } };
  if (Q.get('draft')) DRAFT = parseDraft(Q.get('draft'));
  if (S.filter === 'restricted') S.f.status = 'active';
  if (S.filter === 'inactive') S.f.status = 'inactive';
  if (S.view === 'new') S.tab = Q.get('tab') || 'access';

  /* ---------- access facts (one place, like the server's visibility port) ---------- */
  const effView = (a) => uniq([...a.view, ...a.edit, ...a.assign]);
  const isRestricted = (a) => effView(a).length > 0;
  const allInactive = (a) => isRestricted(a) && effView(a).every((id) => !roleOf(id).active);
  const lists = () => (DRAFT ? { view: effView(DRAFT), edit: DRAFT.edit, assign: DRAFT.assign } : { view: effView(cur().access), edit: cur().access.edit, assign: cur().access.assign });
  const sameSet = (x, y) => x.length === y.length && x.every((v) => y.includes(v));
  const dirty = () => {
    if (S.view === 'new') return true;
    if (!DRAFT) return false; const sv = effView(cur().access), dv = effView(DRAFT);
    return !sameSet(sv, dv) || !sameSet(cur().access.edit, DRAFT.edit) || !sameSet(cur().access.assign, DRAFT.assign);
  };
  function summaryParts(a) {
    const v = effView(a).length, e = a.edit.length, g = a.assign.length;
    return [plural(v, 'role') + ' can view', e ? e + ' can edit' : 'all viewers can edit', g ? g + ' can be assigned' : 'all viewers can be assigned'];
  }
  const summaryText = (a) => (isRestricted(a) ? 'Restricted: ' + summaryParts(a).join(', ') + '.' : 'Open to everyone.');

  /* The preview the server answers (POST /task-types/{id}/access/preview). Mockup arithmetic: people = members of the roles, capped at the 86 people who can open tasks. */
  function allowed(a, which) {
    const act = (ids) => Math.min(D.PEOPLE, ids.reduce((n, id) => n + (roleOf(id).active ? roleOf(id).members : 0), 0));
    if (!isRestricted(a)) return D.PEOPLE;
    if (which === 'edit') return a.edit.length ? act(a.edit) : act(effView(a));
    return act(effView(a));
  }
  function computePreview(t, was, now) {
    const v = viewer(); const pv = { isRestricted: isRestricted(now), becomesOpenToEveryone: isRestricted(was) && !isRestricted(now) };
    pv.peopleLosingView = Math.max(0, allowed(was) - allowed(now));
    pv.peopleLosingEdit = Math.max(0, allowed(was, 'edit') - allowed(now, 'edit') - pv.peopleLosingView);
    pv.openTasksBecomingHidden = pv.peopleLosingView > 0 ? t.open : 0;
    pv.openTasksAssignedToPeopleLosingView = pv.peopleLosingView > 0 ? Math.min(t.hideAssigned == null ? 2 : t.hideAssigned, t.open) : 0;
    const had = !isRestricted(was) || v.sysAdmin || effView(was).some((id) => v.roles.includes(id));
    pv.callerLosesView = !v.sysAdmin && had && isRestricted(now) && !effView(now).some((id) => v.roles.includes(id));
    return pv;
  }
  const FORCED = {
    hide: { isRestricted: true, becomesOpenToEveryone: false, openTasksBecomingHidden: 14, peopleLosingView: 61, openTasksAssignedToPeopleLosingView: 3, peopleLosingEdit: 0, callerLosesView: false },
    open: { isRestricted: false, becomesOpenToEveryone: true, openTasksBecomingHidden: 0, peopleLosingView: 0, openTasksAssignedToPeopleLosingView: 0, peopleLosingEdit: 0, callerLosesView: false },
    lose: { isRestricted: true, becomesOpenToEveryone: false, openTasksBecomingHidden: 14, peopleLosingView: 61, openTasksAssignedToPeopleLosingView: 3, peopleLosingEdit: 0, callerLosesView: true },
    all: { isRestricted: true, becomesOpenToEveryone: false, openTasksBecomingHidden: 14, peopleLosingView: 61, openTasksAssignedToPeopleLosingView: 3, peopleLosingEdit: 17, callerLosesView: true },
    notenforced: { isRestricted: true, becomesOpenToEveryone: false, openTasksBecomingHidden: 14, peopleLosingView: 61, openTasksAssignedToPeopleLosingView: 3, peopleLosingEdit: 0, callerLosesView: false },
  };
  const needsConfirm = (pv) => pv.peopleLosingView > 0 || pv.peopleLosingEdit > 0 || pv.becomesOpenToEveryone || pv.callerLosesView;

  /* ---------- tooltips (D-18, [mfTip]: hover after 300 ms and keyboard focus) ---------- */
  let tipEl = null, tipTimer = null;
  function showTip(target, html) {
    hideTip(); tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); tipEl.innerHTML = html; document.body.appendChild(tipEl);
    const r = target.getBoundingClientRect(); const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8); let y = r.top - h - 6; if (y < 8) y = r.bottom + 6;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } }
  document.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-tip]'); if (!t) return; clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(t, t.getAttribute('data-tip')), 300); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t, t.getAttribute('data-tip')); });
  document.addEventListener('focusout', hideTip);

  const tipForAccess = (t) => {
    const a = t.access; const row = (l, ids, empty) => '<div><b>' + l + ':</b> ' + (ids.length ? esc(listText(ids)) : empty) + '</div>';
    if (!isRestricted(a)) return '<div><b>Open to everyone.</b></div><div>No role limits: everyone who can use tasks can see, edit and be assigned this task type.</div>';
    let h = row('Can View', effView(a), '') + row('Can Edit', a.edit, 'no extra limit') + row('Can Be Assigned', a.assign, 'no extra limit');
    if (allInactive(a)) h += '<div>All Can View roles are inactive, so only System Admin can see this task type.</div>';
    else if (!S.enforced) h += '<div>Saved, but not enforced yet.</div>';
    return h;
  };

  /* ---------- small parts ---------- */
  const chip = (label, icon, tone, extra) => '<span class="chip chip--' + tone + '">' + ic(icon) + label + (extra || '') + '</span>';
  const activeChip = (on) => (on ? chip('Active', 'check-circle', 'ok') : chip('Inactive', 'minus-circle', 'neutral'));
  const ttTile = (t, sm) => '<span class="ttt ' + (sm ? 'ttt--sm ' : '') + 'tt-' + t.colour + '" aria-hidden="true">' + ic(t.icon) + '</span>';
  function accessChip(t) {
    const a = t.access;
    if (!isRestricted(a)) return '<span class="muted" data-tip="' + esc(tipForAccess(t)) + '" tabindex="0">Everyone</span>';
    const bad = allInactive(a);
    const lab = (bad ? chip('Restricted', 'exclamation-triangle', 'risk') : chip('Restricted', 'lock', 'off', S.cellCount ? ' <span class="n">' + effView(a).length + '</span>' : ''));
    return '<button type="button" class="chipbtn" data-tipid="row-' + t.id + '" data-tip="' + esc(tipForAccess(t)) + '" data-a="open|' + t.id + '|access" aria-label="Access for ' + esc(t.name) + ': restricted, ' + plural(effView(a).length, 'role') + ' can view. Open the Access tab.">' + lab + '</button>';
  }
  S.cellCount = Q.get('cell') !== 'plain';

  /* ---------- toasts (D-52) ---------- */
  function toast(kind, title, detail) {
    const t = { id: ++S.nextId, kind, title, detail }; S.toasts.push(t); if (S.toasts.length > 3) S.toasts.shift();
    if (kind !== 'error') setTimeout(() => { S.toasts = S.toasts.filter((x) => x.id !== t.id); drawToasts(); }, kind === 'success' ? 4000 : 6000);
    drawToasts();
  }
  function drawToasts() {
    const el = document.getElementById('toasts'); if (!el) return;
    el.innerHTML = S.toasts.map((t) => '<div class="toast toast--' + t.kind + '" role="' + (t.kind === 'error' ? 'alert' : 'status') + '">' + ic(t.kind === 'error' ? 'times-circle' : t.kind === 'success' ? 'check-circle' : 'info-circle') + '<div class="tt"><b>' + esc(t.title) + '</b>' + (t.detail ? '<span>' + esc(t.detail) + '</span>' : '') + '</div><button class="btn btn--icon" aria-label="Close" data-a="toastx|' + t.id + '">' + ic('times') + '</button></div>').join('');
  }

  /* ---------- frame ---------- */
  const NAVMAIN = [['chart-bar', 'Dashboard'], ['briefcase', 'My Matters'], ['list-check', 'My Work'], ['building', 'Clients'], ['folder', 'Matters'], ['address-book', 'People'], ['users', 'Pod Work'], ['list', 'Task Queue']];
  const NAVADMIN = [['id-card', 'Users'], ['sliders-h', 'Task Types'], ['list', 'Lists'], ['database', 'Asset Types'], ['sliders-v', 'Custom Fields'], ['file', 'Report Setup'], ['history', 'Audit Logs'], ['cog', 'Settings']];
  function nav() {
    const here = S.view === 'roles' ? 'Users' : S.view === 'audit' ? 'Audit Logs' : 'Task Types';
    const a = (i, l) => '<a href="#" data-a="navdead"' + (l === here ? ' aria-current="page"' : '') + '>' + ic(i) + l + '</a>';
    return '<nav class="nav" aria-label="Main"><div class="logo"><i>LH</i>LPT Hub</div>' + NAVMAIN.map(([i, l]) => a(i, l)).join('') + '<div class="sec">Administration</div>' + NAVADMIN.map(([i, l]) => a(i, l)).join('') + '</nav>';
  }
  const top = () => '<header class="top"><div class="gs">' + ic('search') + 'Search clients, matters, tasks, assets...<kbd>Ctrl+K</kbd></div><span class="sp"></span><button class="btn btn--primary" data-a="navdead">' + ic('plus') + 'New Task</button><button class="btn btn--icon" aria-label="Notifications" data-a="navdead">' + ic('bell') + '</button><span class="avatar" title="' + viewer().name + '">PR</span></header>';
  const crumb = (items) => '<nav class="crumb" aria-label="Breadcrumb">' + items.map((x, i) => (i ? ic('chevron-right', 'xs') : '') + (x.go ? '<a href="#" data-a="' + x.go + '">' + x.t + '</a>' : '<span class="' + (i === items.length - 1 ? 'cur' : '') + '">' + x.t + '</span>')).join('') + '</nav>';
  const banner = (tone, icon, html, action) => '<div class="banner' + (tone ? ' banner--' + tone : '') + '" role="' + (tone === 'bad' ? 'alert' : 'status') + '">' + ic(icon) + '<span class="txt">' + html + '</span>' + (action || '') + '</div>';
  const NOT_ENFORCED = 'Access rules are saved but not enforced yet.';

  /* ---------- Task Types list ---------- */
  const COLS = [
    { k: 'name', l: 'Name', sort: 'name' }, { k: 'wf', l: 'Default Workflow', w: 179, sort: 'wf' }, { k: 'form', l: 'Request Form', w: 143, sort: 'form' },
    { k: 'access', l: 'Access', w: S.cellCount ? 148 : 128, sort: 'access', first: 'desc' }, { k: 'target', l: 'Target (Days)', w: 122, num: 1, optional: true }, { k: 'workflows', l: 'Workflows', w: 128, num: 1, sort: 'workflows' },
    { k: 'open', l: 'Open Tasks', w: 125, num: 1, sort: 'open' }, { k: 'status', l: 'Status', w: 140, sort: 'status' }, { k: 'act', l: '', w: 48 },
  ];
  S.showTarget = Q.get('target') === '1';
  const shownCols = () => COLS.filter((c) => !c.optional || S.showTarget);
  function listRows() {
    let rows = TYPES.filter((t) => {
      if (S.f.status === 'active' && !t.active) return false; if (S.f.status === 'inactive' && t.active) return false;
      if (S.f.name && !t.name.toLowerCase().includes(S.f.name.toLowerCase())) return false;
      if (S.f.form && t.form.toLowerCase() !== S.f.form) return false;
      if (S.f.access === 'restricted' && !isRestricted(t.access)) return false; if (S.f.access === 'everyone' && isRestricted(t.access)) return false;
      return true;
    });
    const k = S.sort.key, dir = S.sort.dir === 'asc' ? 1 : -1;
    const val = (t) => (k === 'access' ? (isRestricted(t.access) ? 1 : 0) : k === 'status' ? (t.active ? 1 : 0) : k === 'form' ? t.form : k === 'wf' ? t.wf : t[k]);
    rows.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'string' ? x.localeCompare(y) : x - y; return c * dir || a.name.localeCompare(b.name); });
    return rows;
  }
  const stripDefs = () => [
    ['active', 'Active', (t) => t.active, { status: 'active', access: '', form: '' }, ''],
    ['restricted', 'Restricted', (t) => t.active && isRestricted(t.access), { status: 'active', access: 'restricted', form: '' }, 'Active task types limited to some roles'],
    ['notusable', 'Not Usable', (t) => t.active && !t.usable, { status: 'active' }, "Active task types users can't create tasks of"],
    ['draft', 'Form in Draft', (t) => t.active && t.form === 'Draft', { status: 'active', form: 'draft' }, 'Active task types whose request form is a draft'],
    ['inactive', 'Inactive', (t) => !t.active, { status: 'inactive', access: '', form: '' }, ''],
  ];
  const stripOn = () => (S.f.access === 'restricted' ? 'restricted' : S.f.status === 'inactive' ? 'inactive' : S.f.form === 'draft' ? 'draft' : S.f.status === 'active' && !S.f.name && !S.f.access && !S.f.form ? 'active' : '');
  const filterCount = () => ['name', 'form', 'access'].filter((k) => S.f[k]).length + (S.f.status !== 'active' ? 1 : 0);
  function listHeader() {
    const n = filterCount();
    return crumb([{ t: 'Administration' }, { t: 'Task Types' }]) +
      '<div class="ph"><span class="tile">' + ic('sliders-h') + '</span><h1>Task Types</h1><span class="hdr-actions">' + (n ? '<button class="btn btn--text" data-a="clear">Clear Filters</button>' : '') + '<button class="btn" data-a="navdead">' + ic('filter') + 'Filters (' + (n || 1) + ')</button><button class="btn btn--primary" data-a="new">' + ic('plus') + 'New Task Type</button></span></div>' +
      '<p class="pdesc">What people can request: a request form and its eligible workflows.</p>' +
      '<div class="tabs" role="tablist" aria-label="Task type sections"><button class="tab" role="tab" aria-selected="true">' + ic('tag') + 'Task Types<span class="cnt">' + TYPES.length + '</span></button><button class="tab" role="tab" aria-selected="false" data-a="navdead">' + ic('sitemap') + 'Workflows<span class="cnt">9</span></button><button class="tab" role="tab" aria-selected="false" data-a="navdead">' + ic('list-check') + 'Steps<span class="cnt">31</span></button></div>';
  }
  function th(c) {
    if (c.k === 'act') return '<th class="act" scope="col"><span class="sr">Actions</span></th>';
    const on = S.sort.key === c.sort; const icn = on ? (S.sort.dir === 'asc' ? 'sort-amount-up-alt' : 'sort-amount-down') : 'sort-alt';
    const inner = c.sort ? '<button class="sortbtn" data-a="sort|' + c.sort + '" aria-label="Sort by ' + c.l + '">' + c.l + ic(icn) + '</button>' : c.l;
    return '<th scope="col"' + (c.num ? ' class="num"' : '') + (on ? ' aria-sort="' + (S.sort.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' + inner + '</th>';
  }
  function filterRow() {
    const sel = (key, opts, allLabel, label) => '<select class="selx' + (S.f[key] && !(key === 'status' && S.f[key] === 'active') || (key === 'status' && S.f.status !== 'active') ? ' selx--on' : '') + '" data-f="' + key + '" aria-label="' + label + '"><option value="">' + allLabel + '</option>' + opts.map(([v, l]) => '<option value="' + v + '"' + (S.f[key] === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    return '<tr class="fr">' + shownCols().map((c) => {
      if (c.k === 'name') return '<td><input class="inp" data-f="name" placeholder="Name" value="' + esc(S.f.name) + '" aria-label="Filter by Name"></td>';
      if (c.k === 'form') return '<td>' + sel('form', [['published', 'Published'], ['draft', 'Draft'], ['no form', 'No Form']], 'All Forms', 'Filter by Request Form') + '</td>';
      if (c.k === 'access') return '<td>' + sel('access', [['everyone', 'Everyone'], ['restricted', 'Restricted']], 'All Access', 'Filter by Access') + '</td>';
      if (c.k === 'status') return '<td>' + '<select class="selx' + (S.f.status !== 'active' ? ' selx--on' : '') + '" data-f="status" aria-label="Filter by Status"><option value="active"' + (S.f.status === 'active' ? ' selected' : '') + '>Active</option><option value="inactive"' + (S.f.status === 'inactive' ? ' selected' : '') + '>Inactive</option><option value="all"' + (S.f.status === 'all' ? ' selected' : '') + '>All Statuses</option></select></td>';
      return '<td></td>';
    }).join('') + '</tr>';
  }
  function listRow(t) {
    return '<tr class="' + (t.active ? '' : 'inactive') + '">' + shownCols().map((c) => {
      switch (c.k) {
        case 'name': return '<td><span class="ttcell">' + ttTile(t, true) + '<a class="link" href="#" data-a="open|' + t.id + '|overview" title="' + esc(t.name) + '">' + esc(t.name) + '</a></span></td>';
        case 'wf': return '<td><span class="clip" title="' + esc(t.wf) + '">' + (t.wf === 'No workflow' ? '<span class="muted">No workflow</span>' : esc(t.wf) + (t.wfMore ? ' <span class="muted">+' + t.wfMore + '</span>' : '')) + '</span></td>';
        case 'form': return '<td class="nowrap">' + esc(t.form) + (t.formV ? ' <span class="muted">' + t.formV + '</span>' : '') + '</td>';
        case 'access': return '<td data-access>' + accessChip(t) + '</td>';
        case 'target': return '<td class="num">' + (t.target == null ? '<span class="muted">-</span>' : t.target) + '</td>';
        case 'workflows': return '<td class="num">' + (t.workflows ? '<a class="link" href="#" data-a="navdead">' + t.workflows + '</a>' : '<span class="muted">0</span>') + '</td>';
        case 'open': return '<td class="num">' + (t.open ? '<a class="link" href="#" data-a="navdead">' + t.open + '</a>' : '<span class="muted">0</span>') + '</td>';
        case 'status': return '<td class="nowrap">' + activeChip(t.active) + (!t.usable && t.active ? ' <span class="chip chip--neutral" title="Not Usable">' + ic('info-circle') + '</span>' : '') + '</td>';
        default: return '<td class="act"><button class="btn btn--icon" aria-label="Actions for ' + esc(t.name) + '" data-a="navdead">' + ic('ellipsis-h') + '</button></td>';
      }
    }).join('') + '</tr>';
  }
  function listBody(rows, cols) {
    if (S.scene === 'loading') return Array.from({ length: 9 }, () => '<tr>' + cols.map((c) => '<td>' + (c.k === 'act' ? '' : '<span class="sk" style="width:' + (c.k === 'name' ? 60 : 55) + '%"></span>') + '</td>').join('') + '</tr>').join('');
    if (S.scene === 'error' || S.scene === 'empty' || !rows.length) return '';
    return rows.map(listRow).join('');
  }
  function listState(rows) {
    if (S.scene === 'loading') return '';
    if (S.scene === 'error') return '<div class="state">' + ic('exclamation-triangle', 'warn') + '<p>Couldn\'t load task types.</p><small>The server did not answer.</small><button class="btn" data-a="retry">Retry</button></div>';
    if (S.scene === 'empty') return '<div class="state">' + ic('tag') + '<p>No task types yet.</p><button class="btn btn--primary" data-a="new">' + ic('plus') + 'New Task Type</button></div>';
    if (!rows.length) return '<div class="state">' + ic('filter') + '<p>No task types match these filters.</p><button class="btn" data-a="clear">Clear Filters</button></div>';
    return '';
  }
  function listPage() {
    if (S.scene === 'allopen') TYPES.forEach((t) => (t.access = { view: [], edit: [], assign: [] }));
    const rows = listRow && listRows(); const cols = shownCols();
    const restricted = TYPES.filter((t) => t.active && isRestricted(t.access)).length;
    const strip = stripDefs().map(([k, l, fn, , hint]) => { const n = TYPES.filter(fn).length; const on = stripOn() === k; return '<button class="fchip" aria-pressed="' + on + '" data-a="strip|' + k + '"' + (hint ? ' data-tip="' + esc(hint) + '"' : '') + '>' + (on ? ic('check') : '') + l + ' <span class="c">' + n + '</span></button>'; }).join('');
    const total = rows.length;
    const loaded = S.scene === 'normal' || S.scene === 'allopen';
    return '<main class="main" id="main"><div class="page">' + listHeader() +
      (!S.enforced && restricted > 0 && loaded ? banner('risk', 'exclamation-triangle', '<b>' + NOT_ENFORCED + '</b> ' + plural(restricted, 'restricted task type') + (restricted === 1 ? ' is' : ' are') + ' still visible to everyone until Task Type Access is switched on.') : '') +
      '<div class="strip" role="group" aria-label="Task types summary">' + strip + '<span class="sp"></span><button class="btn" data-a="navdead">' + ic('table') + 'Columns</button></div>' +
      '<div class="frame"><div class="scroll"><table class="gridtable" aria-label="Task types list"><colgroup>' + cols.map((c) => '<col' + (c.w ? ' style="width:' + c.w + 'px"' : '') + '>').join('') + '</colgroup><thead><tr>' + cols.map(th).join('') + '</tr>' + filterRow() + '</thead><tbody>' + listBody(rows, cols) + '</tbody></table>' + listState(rows) + '</div>' +
      '<div class="pager"><span class="rows">Rows per page <select class="selx" aria-label="Rows per page"><option>50</option></select></span><span class="mid">' + (loaded && total ? 'Showing 1-' + total + ' of ' + total : 'Showing 0 of 0') + '</span><span class="pg">Page 1 of 1 <button class="btn" disabled>First</button><button class="btn" disabled>Previous</button><button class="btn" disabled>Next</button><button class="btn" disabled>Last</button></span></div></div></div></main>';
  }

  /* ---------- Task Type record page ---------- */
  const TABS = [['overview', 'Overview', 'home'], ['workflows', 'Workflows', 'sitemap'], ['form', 'Request Form', 'file'], ['access', 'Access', 'lock']];
  function recordHeader(t) {
    const isNew = S.view === 'new'; const a = t.access;
    const name = isNew ? 'New task type' : t.name;
    const chips = isNew ? '' : activeChip(t.active) + (isRestricted(a) ? '<span data-tipid="chip" data-tip="' + esc(tipForAccess(t)) + '" tabindex="0">' + (allInactive(a) ? chip('Restricted', 'exclamation-triangle', 'risk') : chip('Restricted', 'lock', 'off')) + '</span>' : '');
    return crumb([{ t: 'Administration' }, { t: 'Task Types', go: 'tolist' }, { t: esc(name) }]) +
      '<div class="ph">' + (isNew ? '' : ttTile(t)) + '<h1>' + esc(name) + '</h1>' + chips + '<span class="hdr-actions">' + (isNew ? '' : '<button class="btn" data-a="navdead">' + ic('history') + 'Activity</button><button class="btn btn--primary" data-a="navdead">' + ic('pencil') + 'Edit Form</button><button class="btn btn--icon" aria-label="More actions" data-a="navdead">' + ic('ellipsis-h') + '</button>') + '</span></div>' +
      (isNew ? '' : (t.desc ? '<p class="pdesc">' + esc(t.desc) + '</p>' : '') + '<div class="facts" aria-label="Task type summary"><span class="f">' + t.workflows + ' <span class="m">workflows</span></span><span class="f">Form <span class="m">' + esc(t.form + ' ' + t.formV) + '</span></span><span class="f">' + t.open + ' <span class="m">open tasks</span></span></div>');
  }
  function tabsBar() {
    const t = cur(); const items = S.placement === 'section' ? TABS.filter((x) => x[0] !== 'access') : TABS;
    return '<div class="tabs" role="tablist" aria-label="Task type sections">' + items.map(([k, l, i]) => {
      const dis = k === 'form' && S.view === 'new';
      return '<button class="tab" role="tab" id="tt-tab-' + k + '" aria-selected="' + (S.tab === k || (S.placement === 'section' && S.tab === 'access' && k === 'overview')) + '"' + (dis ? ' aria-disabled="true" data-tip="Save the task type first"' : ' data-a="tab|' + k + '"') + '>' + ic(i) + l + (k === 'workflows' && S.view !== 'new' ? '<span class="cnt">' + t.workflows + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function overviewForm(t) {
    const isNew = S.view === 'new';
    return '<form class="sect" onsubmit="return false" aria-labelledby="h-gen"><h2 id="h-gen">General</h2><div class="formgrid one">' +
      '<div class="fld"><label class="lbl" for="tt-name">Name <span class="req">(required)</span></label><input class="inp" id="tt-name" value="' + esc(isNew ? '' : t.name) + '" maxlength="100"><p class="help">' + (isNew ? 0 : t.name.length) + ' / 100</p></div>' +
      '<div class="fld"><label class="lbl" for="tt-icon">Icon <span class="req">(required)</span></label><div class="withbtn"><span class="ttt tt-' + t.colour + '">' + ic(t.icon) + '</span><button type="button" class="btn" id="tt-icon">Choose Icon</button></div><p class="help">Shown next to the task type\'s name in lists, on task pages and when people choose a type.</p></div>' +
      '<div class="fld"><label class="lbl" for="tt-target">Expected Turnaround (days)</label><input class="inp" id="tt-target" value="' + (t.target == null ? '' : t.target) + '" style="max-width:160px"><p class="help">Optional, in calendar days (1 to 365). An open task that has used 80 percent of it and is not yet overdue is shown as At risk.</p></div>' +
      '<div class="fld"><label class="lbl" for="tt-desc">Description</label><textarea class="inp ta" id="tt-desc">' + esc(t.desc || '') + '</textarea></div></div></form>';
  }

  /* the role multi-select field: mf-dropdown field + multi, chosen roles as removable tag chips under it */
  const FIELDS = {
    view: { label: 'Can View', empty: 'Everyone (No Limit)', help: 'Roles that can see this task type. Leave empty so everyone can.' },
    edit: { label: 'Can Edit', empty: 'No Extra Limit', help: 'Roles that can change its tasks and create new ones. Leave empty so everyone who can view can also edit.' },
    assign: { label: 'Can Be Assigned', empty: 'No Extra Limit', help: 'Roles whose people can be chosen as assignee. Leave empty so any viewer who normally takes tasks can be.' },
  };
  function fieldErrorFor(k) {
    if (S.state === 'fielderror' && k === 'view') return 'Contract Reviewer is inactive. Remove it, or choose an active role.';
    return S.fieldErr && S.fieldErr[k];
  }
  function roleField(k) {
    const f = FIELDS[k]; const L = lists(); const open = S.menu === k; const A = DRAFT || cur().access;
    const chosen = k === 'view' ? effView(A) : A[k];
    const locked = (id) => k === 'view' && (A.edit.includes(id) || A.assign.includes(id));
    const trig = chosen.length ? esc(rname(byName(chosen)[0])) + (chosen.length > 1 ? ' +' + (chosen.length - 1) : '') : f.empty;
    const err = fieldErrorFor(k);
    const chips = byName(chosen).map((id) => {
      const r = roleOf(id);
      if (locked(id)) {
        const why = (A.edit.includes(id) ? 'Can Edit' : 'Can Be Assigned');
        return '<span class="tagrm tagrm--auto" data-tip="' + esc(r.name + ' is in ' + why + ', so it can also view. Remove it from ' + why + ' first.') + '" tabindex="0">' + esc(r.name) + ic('link') + '</span>';
      }
      return '<span class="tagrm' + (r.active ? '' : ' tagrm--warn') + '">' + (r.active ? '' : ic('exclamation-triangle') + ' ') + esc(r.name) + '<button type="button" aria-label="Remove ' + esc(r.name) + '" data-a="rm|' + k + '|' + id + '">' + ic('times') + '</button></span>';
    }).join('');
    let panel = '';
    if (open) {
      const sel = (id) => (k === 'view' ? effView(A).includes(id) : A[k].includes(id));
      panel = '<div class="dd-list" role="listbox" aria-multiselectable="true" aria-label="' + f.label + ' roles"><button type="button" role="option" aria-checked="' + (chosen.length === 0) + '" data-a="clearrole|' + k + '"><span class="box">' + (chosen.length === 0 ? ic('check') : '') + '</span>' + f.empty + '</button><hr>' +
        D.ROLES.map((r) => {
          const on = sel(r.id); const dis = !r.active || locked(r.id);
          return '<button type="button" role="option" aria-checked="' + on + '"' + (dis && !on ? ' aria-disabled="true"' : '') + ' data-a="role|' + k + '|' + r.id + '"><span class="box">' + (on ? ic('check') : '') + '</span>' + esc(r.name) + (r.active ? '<span class="cn">' + r.members + '</span>' : '<span class="cn">Inactive</span>') + '</button>';
        }).join('') + '<hr><div class="done"><button type="button" class="btn" data-a="menu|' + k + '">Done</button></div></div>';
    }
    return '<div class="fld ddf"><label class="lbl" id="l-' + k + '" for="b-' + k + '">' + f.label + '</label><div class="ddw"><button type="button" class="trig' + (err ? ' inv' : '') + '" id="b-' + k + '" aria-haspopup="listbox" aria-expanded="' + open + '" aria-describedby="h-' + k + '" data-a="menu|' + k + '"><span class="val' + (chosen.length ? '' : ' ph0') + '">' + trig + '</span>' + ic('chevron-down') + '</button>' + panel + '</div>' +
      (chips ? '<div class="chosen" aria-label="' + f.label + ' roles chosen">' + chips + '</div>' : '') +
      (err ? '<p class="err" role="alert">' + ic('exclamation-circle') + err + '</p>' : '') +
      '<p class="help" id="h-' + k + '">' + f.help + (k === 'view' ? '<span class="hint-i" style="margin-top:4px">' + ic('info-circle') + '<span>Roles in Can Edit or Can Be Assigned are added here (link icon).</span></span>' : '') + '</p></div>';
  }
  function summaryCard() {
    const L = lists(); const a = { view: L.view, edit: L.edit, assign: L.assign }; const open = !isRestricted(a); const bad = allInactive(a);
    const icon = open ? ic('users') : bad ? ic('exclamation-triangle') : ic('lock');
    return '<aside class="card sumcard" aria-labelledby="h-sum" data-tipid="summary"><h2 id="h-sum">Summary</h2><div class="sumline ' + (bad ? 'bad' : '') + '">' + icon +
      '<p role="status" aria-live="polite" data-summary>' + (open ? 'Open to everyone.' : esc(summaryText(a))) + '</p></div>' +
      (open ? '<p class="help">Everyone who can use tasks can see, edit and be assigned tasks of this type.</p>' : '') +
      (bad ? '<p class="warnline" role="status">' + ic('exclamation-triangle') + '<span>Every role in Can View is inactive and grants nothing, so only System Admin can see this task type. Choose an active role, or empty the list to open it to everyone.</span></p>' : '') +
      (S.view === 'new' ? '<p class="help">The rules are saved together with the new task type.</p>' : '') + '<hr><h2 style="font-size:var(--mf-fs-md)">How access works</h2><ul class="rules">' +
      '<li>' + ic('users') + '<span>A person qualifies for a list when any of their roles is in it.</span></li>' +
      '<li>' + ic('eye-slash') + '<span>A task type people cannot view is hidden for them everywhere: lists, counts, search, notifications and exports.</span></li>' +
      '<li>' + ic('shield') + '<span>System Admin always sees every task type. Reports have their own permissions and are not limited by these rules.</span></li></ul></aside>';
  }
  function accessBody(t) {
    if (S.state === 'loading') return '<div class="formgrid" aria-busy="true"><div class="skgrid">' + [0, 1, 2].map(() => '<div class="fld"><span class="sk" style="width:90px"></span><span class="sk" style="height:36px;width:100%"></span><span class="sk" style="width:70%"></span></div>').join('') + '</div><div class="card sumcard"><span class="sk" style="width:40%"></span><span class="sk" style="width:90%"></span><span class="sk" style="width:80%"></span></div></div><span class="sr" role="status">Loading access rules</span>';
    if (S.state === 'error') return '<div class="stateblk">' + ic('exclamation-triangle', 'warn') + '<p>Couldn\'t load the access rules.</p><small>The server did not answer. Nothing was changed.</small><button class="btn" data-a="retry">Retry</button></div>';
    return (S.state === 'stale' || S.conflict ? '<p class="errline" role="alert" data-conflict>' + ic('exclamation-circle') + '<span>Someone else changed this task type. <button type="button" class="btn btn--text" data-a="reload">Reload Latest</button> (your unsaved edits will be discarded).</span></p>' : '') +
      '<div class="formgrid"><div>' + roleField('view') + roleField('edit') + roleField('assign') + '</div>' + summaryCard() + '</div>';
  }
  function accessSection(t) { return '<section class="sect" aria-labelledby="h-acc"><h2 id="h-acc">Access</h2>' + (!S.enforced ? banner('risk', 'exclamation-triangle', '<b>' + NOT_ENFORCED + '</b> Everyone can still see every task type until IT switches on Task Type Access.') + '<div style="height:12px"></div>' : '') + accessBody(t) + '</section>'; }
  function accessTab(t) {
    return (!S.enforced ? banner('risk', 'exclamation-triangle', '<b>' + NOT_ENFORCED + '</b> Everyone can still see every task type until IT switches on Task Type Access. Your rules are kept and apply the moment it is switched on.') : '') + accessBody(t);
  }
  function footer() {
    const isNew = S.view === 'new'; if (!isNew && !dirty()) return '';
    if (S.state === 'loading' || S.state === 'error') return '';
    return '<div class="actions-row" data-footer><button class="btn" data-a="cancel"' + (S.busy ? ' disabled' : '') + '>Cancel</button><button class="btn btn--primary" data-a="save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving...' : isNew ? 'Create Task Type' : 'Save Changes') + '</button></div>';
  }
  function recordPage() {
    const t = cur(); let body;
    if (S.tab === 'access' && S.placement !== 'section') body = accessTab(t);
    else if (S.tab === 'overview' || S.placement === 'section' && S.tab === 'access') body = overviewForm(t) + (S.placement === 'section' ? accessSection(t) : '');
    else body = '<div class="stateblk">' + ic('info-circle') + '<p>' + (S.tab === 'workflows' ? 'Workflows tab' : 'Request Form tab') + ' unchanged.</p><small>Not part of this mockup. Only the Access tab, the list column, the confirmations and the role and audit wording are new.</small></div>';
    return '<main class="main" id="main"><div class="page">' + recordHeader(t) + tabsBar() + '<div class="panel" role="tabpanel" aria-labelledby="tt-tab-' + S.tab + '" id="panel"><div class="panel-in">' + body + '</div>' + footer() + '</div></div></main>';
  }

  /* ---------- confirm dialog (mf-confirm-dialog, small 416 px) ---------- */
  function confirmDialog() {
    const t = cur(); const name = esc(t.name); const pv = S.pv; const h = (x) => '<b>' + x + '</b>';
    if (S.pvState === 'loading') return dlgShell('Save Access Rules', '<div class="skgrid" aria-busy="true"><span class="sk" style="width:80%"></span><span class="sk" style="width:95%"></span><span class="sk" style="width:60%"></span></div><span class="sr" role="status">Checking who is affected</span>', '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn btn--primary" disabled>Save Access Rules</button>', 'sm');
    if (S.pvState === 'error') return dlgShell('Save Access Rules', '<p class="errline" role="alert">' + ic('exclamation-circle') + '<span>Couldn\'t check who is affected. Nothing was saved. Try again before you save, so you know how many people are affected.</span></p>', '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn btn--primary" data-a="pvretry">Retry</button>', 'sm');
    const lines = []; let lead; let danger = false;
    if (!S.enforced && !pv.becomesOpenToEveryone && (pv.peopleLosingView > 0 || pv.peopleLosingEdit > 0)) {
      lead = 'These rules are saved but not enforced yet, so nobody loses access today.';
      lines.push(['info', 'info-circle', 'When Task Type Access is switched on, this will hide ' + name + ' from ' + plural(pv.peopleLosingView, 'person', 'people') + ' (' + plural(pv.openTasksBecomingHidden, 'open task') + ').']);
    } else if (pv.becomesOpenToEveryone) {
      lead = 'This makes the task type open to everyone.';
      lines.push(['info', 'users', 'Everyone who can use tasks will be able to see and use ' + name + (t.open ? ' and its ' + plural(t.open, 'open task') : '') + '. The roles you removed are no longer needed.']);
    } else if (pv.peopleLosingView > 0) {
      lead = 'This will hide the task type from ' + plural(pv.peopleLosingView, 'person', 'people') + '.';
      lines.push(['info', 'eye-slash', plural(pv.openTasksBecomingHidden, 'open task') + ' of this type will no longer appear for ' + (pv.peopleLosingView === 1 ? 'them' : 'them') + ' in lists, counts, search or notifications.']);
      if (pv.openTasksAssignedToPeopleLosingView > 0) lines.push(['warn', 'exclamation-triangle', plural(pv.openTasksAssignedToPeopleLosingView, 'of those tasks is', 'of those tasks are') + ' assigned to them and ' + (pv.openTasksAssignedToPeopleLosingView === 1 ? 'stays' : 'stay') + ' assigned. Reassign ' + (pv.openTasksAssignedToPeopleLosingView === 1 ? 'it' : 'them') + ' first if the work must continue.']);
    } else {
      lead = 'This will make the task type view only for ' + plural(pv.peopleLosingEdit, 'person', 'people') + '.';
    }
    if (pv.peopleLosingEdit > 0 && (pv.peopleLosingView > 0 || !pv.becomesOpenToEveryone) && S.enforced && pv.peopleLosingView > 0) lines.push(['info', 'pencil', plural(pv.peopleLosingEdit, 'more person', 'more people') + ' can still view it but no longer change it.']);
    if (pv.callerLosesView) { danger = true; lines.push(['bad', 'exclamation-circle', 'You will lose access yourself. You hold none of the chosen roles, so you will no longer see ' + name + '. Only a System Admin can change it back.']); }
    const foot = pv.callerLosesView ? '' : '<p class="cf-foot">You can change the access again at any time.</p>';
    const body = '<p class="cf-lead">' + lead + '</p><ul class="cf-list">' + lines.map(([c, i, tx]) => '<li class="' + c + '">' + ic(i) + '<span>' + tx + '</span></li>').join('') + '</ul>' + foot;
    return dlgShell('Save Access Rules', body, '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn ' + (danger ? 'btn--solid-danger' : 'btn--primary') + '" data-a="confirmsave">Save Access Rules</button>', 'sm');
  }
  function dlgShell(title, body, foot, size, id) {
    return '<div class="scrim" data-a="scrim"><div class="dlg' + (size === 'sm' ? ' dlg--sm' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t"' + (id ? ' id="' + id + '"' : '') + '><div class="dlg-h"><h2 id="dlg-t">' + title + '</h2><button class="btn btn--icon" aria-label="Close" data-a="dlgx">' + ic('times') + '</button></div><div class="dlg-b">' + body + '</div><div class="dlg-f">' + foot + '</div></div></div>';
  }

  /* ---------- Roles (Administration > Users > Roles) ---------- */
  function usedBy() { /* the Task Types that list a role (the 409 meta `taskTypes`) */
    const id = S.rolesSel;
    if (S.usedBy === '3') return [['Legal Hold Notice', 4], ['Privilege Review', 3], ['Vendor Invoice Approval', 6]];
    return TYPES.filter((t) => effView(t.access).includes(id)).map((t) => [t.name, t.id]);
  }
  function rolesPage() {
    const r = D.ROLE_ROWS.find((x) => x.id === S.rolesSel) || D.ROLE_ROWS[0]; const role = roleOf(r.id); const uses = usedBy();
    const err = S.rolesError ? '<div class="errline" role="alert" data-error>' + ic('exclamation-circle') + '<div><div>This role is used by ' + plural(uses.length, 'Task Type') + '. Remove it there first.</div><ul class="tts">' + uses.map(([n, id]) => '<li><button class="btn btn--text" data-a="open|' + id + '|access">' + esc(n) + '</button><span class="m">Open the Access tab</span></li>').join('') + '</ul></div></div>' : '';
    const perms = [['Task.View', 'See tasks'], ['Task.Edit', 'Change tasks'], ['Task.Assign', 'Assign tasks'], ['Workflow.Execute', 'Work on workflow steps']];
    return '<main class="main" id="main"><div class="page">' + crumb([{ t: 'Administration' }, { t: 'Users' }]) +
      '<div class="ph"><span class="tile">' + ic('id-card') + '</span><h1>Users</h1></div><p class="pdesc">Who can sign in, what they can do and who is waiting for access.</p>' +
      '<div class="tabs" role="tablist" aria-label="User sections"><button class="tab" role="tab" aria-selected="false" data-a="navdead">' + ic('user') + 'Users<span class="cnt">32</span></button><button class="tab" role="tab" aria-selected="true">' + ic('shield') + 'Roles<span class="cnt">15</span></button><button class="tab" role="tab" aria-selected="false" data-a="navdead">' + ic('users') + 'Pods<span class="cnt">6</span></button></div>' +
      '<div class="layout"><section class="rlist" aria-label="Roles list">' + D.ROLE_ROWS.map((x) => '<button class="rbtn" data-a="rolesel|' + x.id + '"' + (x.id === r.id ? ' aria-current="true"' : '') + '><span class="t"><span>' + esc(x.name) + '</span><span class="cn">' + plural(roleOf(x.id).members, 'member') + '</span></span><span class="d">' + esc(x.desc) + '</span></button>').join('') + '</section>' +
      '<section class="editor" aria-label="Role editor"><h2>' + esc(r.name) + '</h2><div class="fld"><label class="lbl" for="r-name">Name <span class="req">(required)</span></label><input class="inp" id="r-name" value="' + esc(r.name) + '" style="max-width:480px"></div><div class="fld"><label class="lbl" for="r-desc">Description</label><input class="inp" id="r-desc" value="' + esc(r.desc) + '" style="max-width:480px"></div>' +
      '<div class="fld"><span class="lbl">Permissions</span><div class="perm">' + perms.map(([c, d], i) => '<label><input type="checkbox"' + (i < Math.min(6, r.perms / 4) || i < 3 ? ' checked' : '') + '><span>' + c + '<span class="d">' + d + '</span></span></label>').join('') + '</div></div>' +
      '<p class="help">Changes apply on each user\'s next request.</p>' + err +
      '<div class="ed-actions"><button class="btn btn--solid-danger" data-a="dlg|delete">' + 'Delete Role</button><span class="sp"></span><button class="btn" data-a="navdead">Cancel</button><button class="btn btn--primary" data-a="navdead">Save Changes</button></div></section></div></div></main>';
  }
  function deleteDialog() {
    const r = D.ROLE_ROWS.find((x) => x.id === S.rolesSel) || D.ROLE_ROWS[0];
    return dlgShell('Delete Role', '<p style="margin:0">' + esc(r.name) + ' is removed. This cannot be undone.</p>', '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn btn--solid-danger" data-a="confirmdelete">Delete Role</button>', 'sm');
  }

  /* ---------- Audit Logs ---------- */
  function auditPage() {
    let day = ''; const rows = D.AUDIT.map((e) => {
      const hd = e.day !== day ? '<tr class="day"><th scope="row" colspan="5">' + e.day + '</th></tr>' : ''; day = e.day;
      const label = D.EVENT_LABELS[e.code];
      return hd + '<tr><td class="when">' + e.when + '</td><td>' + esc(e.who) + '</td><td class="what" title="' + esc(e.text) + '"><b>' + label + '</b><span>' + esc(e.text) + '</span></td><td><span class="muted">Task type</span> <a class="link" href="#" data-a="navdead">' + esc(e.obj) + '</a></td><td class="act"><button class="btn btn--icon" aria-label="Actions" data-a="navdead">' + ic('ellipsis-h') + '</button></td></tr>';
    }).join('');
    const opts = S.menu === 'event' ? '<div class="opts"  style="left:512px;top:300px" role="listbox" aria-label="Event Type"><button role="option" aria-checked="false">All Events</button><button role="option" aria-checked="false">Task type opened to everyone</button><button role="option" aria-checked="true" class="hl">Task type access changed</button><button role="option" aria-checked="false">Task type restricted</button><button role="option" aria-checked="false">Task type workflows changed</button><button role="option" aria-checked="false">Team member added</button><button role="option" aria-checked="false">Team member removed</button></div>' : '';
    return '<main class="main" id="main"><div class="page">' + crumb([{ t: 'Administration' }, { t: 'Audit Logs' }]) +
      '<div class="ph"><span class="tile">' + ic('history') + '</span><h1>Audit Logs</h1><span class="hdr-actions"><button class="btn" data-a="navdead">' + ic('filter') + 'Filters (1)</button></span></div><p class="pdesc">Every recorded change, newest first. Read only.</p>' +
      '<div class="strip" role="group" aria-label="Quick views"><button class="fchip" aria-pressed="false">Today</button><button class="fchip" aria-pressed="false">Last 7 Days</button><button class="fchip" aria-pressed="true">' + ic('check') + 'Configuration Changes</button><button class="fchip" aria-pressed="false">Access Changes</button></div>' +
      '<div class="frame" style="position:relative"><div class="scroll"><table class="au" aria-label="Audit events, newest first"><colgroup><col style="width:128px"><col style="width:168px"><col><col style="width:280px"><col style="width:48px"></colgroup><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Target</th><th class="act" scope="col"><span class="sr">Actions</span></th></tr>' +
      '<tr class="fr"><td><select class="selx" aria-label="When"><option>Any Date</option></select></td><td><select class="selx" aria-label="Who"><option>Anyone</option></select></td><td style="display:flex;gap:8px;border-top:0"><button class="selx selx--on" style="text-align:left;width:236px;height:32px;white-space:nowrap" data-a="menu|event" aria-haspopup="listbox">Task type access changed</button><input class="inp" placeholder="Summary or Field"></td><td><select class="selx" aria-label="Target"><option>All Targets</option></select></td><td></td></tr></thead><tbody>' + rows + '</tbody></table></div>' + opts +
      '<div class="pager"><span class="rows">Rows per page <select class="selx"><option>50</option></select></span><span class="mid">Showing 1-6 of 6</span><span class="pg">Page 1 of 1</span></div></div></div></main>';
  }

  /* ---------- guide (mockup chrome, not product) ---------- */
  function guide() {
    const sel = (k, opts, c) => '<select data-s="' + k + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (c === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    const link = (label, q) => '<a href="?' + q + '&guide=1">' + label + '</a>';
    return '<button class="mk-pill" data-a="guide" aria-expanded="' + S.guide + '">' + ic('book') + 'Mockup Guide</button><div class="mk-badge">Mockup: no app code, nothing saves</div>' +
      (S.guide ? '<div class="mk-panel" role="dialog" aria-label="Mockup guide"><h2>Task Type access</h2><p>Issue #1402, epic #1397. Desktop only: 1366x768 and 1920x1080. Today is 11/17/2026 here. All data is invented.</p>' +
        '<h3>Screens</h3>' + link('1. Task Types list with the Access column', 'view=list&tip=access') + link('1b. List filtered to Restricted', 'view=list&filter=restricted') + link('2. Access tab, restricted type', 'view=record&id=3&tab=access') +
        link('2b. Access tab, editing (Can Edit open)', 'view=record&id=3&tab=access&draft=view:1,4,7|edit:1,7,6|assign:1,4&menu=edit') + link('2c. Access tab, open type', 'view=record&id=1&tab=access') + link('2d. Access as a section of Overview (alternative)', 'view=record&id=3&tab=access&placement=section') +
        link('2e. New Task Type, Access tab', 'view=new&tab=access') + link('3a. Confirm: hides the type', 'view=record&id=3&dialog=confirm&preview=hide&draft=view:1,4,7') + link('3b. Confirm: opens to everyone', 'view=record&id=3&dialog=confirm&preview=open&draft=view:') + link('3c. Confirm: you lose access', 'view=record&id=3&dialog=confirm&preview=lose&draft=view:1,4,7') +
        link('3d. Confirm: all warnings', 'view=record&id=3&dialog=confirm&preview=all&draft=view:1,4,7') + link('3e. Confirm: not enforced', 'view=record&id=3&dialog=confirm&preview=notenforced&enforced=0&draft=view:1,4,7') + link('4. Switch off: banners', 'view=list&enforced=0') + link('5. Roles: role is used by a Task Type', 'view=roles&error=1') +
        link('6. Audit Logs, new events', 'view=audit') + link('7. States: loading, error, empty', 'view=list&scene=loading') +
        '<h3>Switches (reload)</h3><label>Access rules enforced' + sel('enforced', [['1', 'On (Features:TaskTypeAccess)'], ['0', 'Off: saved, not enforced']], S.enforced ? '1' : '0') + '</label>' +
        '<label>Signed in as' + sel('viewer', [['manager', 'Task Type manager (Operations Admin role)'], ['sysadmin', 'System Admin (cannot lose access)']], S.viewer) + '</label>' +
        '<label>List data' + sel('scene', [['normal', 'Normal'], ['allopen', 'No restricted types'], ['empty', 'No task types'], ['loading', 'Loading'], ['error', 'Load error']], S.scene) + '</label>' +
        '<label>Access tab state' + sel('state', [['ready', 'Ready'], ['loading', 'Loading'], ['error', 'Load error'], ['stale', 'Changed by someone else'], ['fielderror', 'Server refuses a role']], S.state) + '</label>' +
        '<label>Confirm shows' + sel('preview', [['auto', 'The real effect of my choices'], ['hide', 'Hides the type'], ['open', 'Opens to everyone'], ['lose', 'You lose access'], ['all', 'All warnings'], ['notenforced', 'Not enforced'], ['loading', 'Checking...'], ['error', "Couldn't check"]], S.pvKind) + '</label>' +
        '<hr><p>URL options: ?view= ?id= ?tab= ?placement= ?enforced= ?viewer= ?scene= ?filter= ?state= ?draft= ?menu= ?dialog= ?preview= ?tip= ?error= ?usedby= ?cell=plain ?target=1 ?chrome=0 ?guide=1. See README.md.</p></div>' : '');
  }

  /* ---------- render ---------- */
  function render() {
    const m = document.getElementById('main'); const pn = document.getElementById('panel'); const st = m ? m.scrollTop : 0, pst = pn ? pn.scrollTop : 0;
    const page = S.view === 'list' ? listPage() : S.view === 'roles' ? rolesPage() : S.view === 'audit' ? auditPage() : recordPage();
    let dlg = '';
    if (S.dlg === 'confirm') dlg = confirmDialog(); else if (S.dlg === 'delete') dlg = deleteDialog();
    $root.innerHTML = '<div class="app">' + nav() + top() + page + '</div><div id="dlghost">' + dlg + '</div><div id="toasts" aria-live="polite"></div>' + guide();
    const m2 = document.getElementById('main'); if (m2) m2.scrollTop = st; const p2 = document.getElementById('panel'); if (p2) p2.scrollTop = pst;
    drawToasts(); document.title = 'Task Type Access Mockup';
    if (S.dlg) { const f = document.querySelector('#dlghost .dlg-f .btn:last-child') || document.querySelector('#dlghost .btn'); if (f && !document.activeElement.closest('#dlghost')) f.focus(); }
    if (Q.get('scroll') === 'access') { const h = document.getElementById('h-acc'); const pn2 = document.getElementById('panel'); if (h && pn2) pn2.scrollTop += h.getBoundingClientRect().top - pn2.getBoundingClientRect().top - 8; }
    if (Q.get('tip') && !S.tipShown) { S.tipShown = true; const k = Q.get('tip'); const el = k === 'access' ? document.querySelector('[data-tipid="row-3"]') : document.querySelector('[data-tipid="' + k + '"]'); if (el) setTimeout(() => showTip(el, el.getAttribute('data-tip')), 50); }
  }

  /* ---------- actions ---------- */
  function openPreview() {
    const t = cur();
    S.dlg = 'confirm'; S.pvState = 'loading'; render();
    const kind = S.pvKind;
    setTimeout(() => {
      if (kind === 'loading') return; if (kind === 'error') { S.pvState = 'error'; render(); return; }
      const A = DRAFT || t.access; const now = { view: effView(A), edit: A.edit, assign: A.assign };
      S.pv = kind === 'auto' ? computePreview(t, t.access, now) : clone(FORCED[kind] || FORCED.hide);
      if (kind === 'auto' && !needsConfirm(S.pv)) { S.pvState = 'ready'; S.dlg = null; commit(); return; }
      S.pvState = 'ready'; render();
    }, 450);
  }
  function commit() {
    const t = cur(); const A = DRAFT || t.access; const was = isRestricted(t.access);
    const saved = { view: effView(A), edit: A.edit.slice(), assign: A.assign.slice() };
    t.access = saved; DRAFT = null; S.busy = false; S.dlg = null; S.fieldErr = null; S.menu = null; render();
    const now = isRestricted(saved);
    toast('success', 'Access rules saved', now ? t.name + ': ' + summaryText(saved).replace('Restricted: ', 'restricted, ').replace(/\.$/, '') + '.' : t.name + ' is open to everyone.' );
    if (!S.enforced) toast('info', 'Not enforced yet', 'The rules apply once Task Type Access is switched on.');
    if (!was && now) { /* the chip in the header appears on the next render */ }
  }
  const acts = {
    guide: () => { S.guide = !S.guide; },
    navdead: () => 'skip',
    tolist: () => { S.view = 'list'; DRAFT = null; S.menu = null; },
    new: () => { S.view = 'new'; S.tab = 'overview'; DRAFT = { view: [], edit: [], assign: [] }; },
    open: (id, tab) => { S.view = 'record'; S.id = +id; S.tab = tab || 'overview'; S.menu = null; DRAFT = null; S.state = 'ready'; },
    tab: (k) => { S.tab = k; S.menu = null; },
    menu: (k) => { if (!DRAFT && S.view !== 'audit') DRAFT = null; S.menu = S.menu === k ? null : k; if (S.menu && (S.view === 'record' || S.view === 'new') && !DRAFT) DRAFT = clone(cur().access); },
    role: (k, id) => {
      id = +id; const r = roleOf(id); if (!r.active) return 'skip'; if (!DRAFT) DRAFT = clone(cur().access); const A = DRAFT; A.view = effView(A);
      const inList = A[k].includes(id);
      if (k === 'view') { if (A.edit.includes(id) || A.assign.includes(id)) return 'skip'; A.view = inList ? A.view.filter((x) => x !== id) : [...A.view, id]; }
      else { A[k] = inList ? A[k].filter((x) => x !== id) : [...A[k], id]; if (!inList && !A.view.includes(id)) A.view = [...A.view, id]; }
      if (sameSet(effView(A), effView(cur().access)) && sameSet(A.edit, cur().access.edit) && sameSet(A.assign, cur().access.assign) && S.view !== 'new') { /* back to saved: footer goes away */ }
    },
    clearrole: (k) => { if (!DRAFT) DRAFT = clone(cur().access); DRAFT[k] = []; if (k === 'view') { DRAFT.view = []; DRAFT.edit = []; DRAFT.assign = []; } },
    rm: (k, id) => { if (!DRAFT) DRAFT = clone(cur().access); id = +id; DRAFT[k] = DRAFT[k].filter((x) => x !== id); },
    cancel: () => { DRAFT = null; S.menu = null; S.fieldErr = null; if (S.view === 'new') S.view = 'list'; },
    save: () => {
      if (S.view === 'new') { toast('success', 'Task type created', 'Access rules saved with it.'); S.view = 'list'; DRAFT = null; return; }
      if (S.state === 'saveerror') { S.busy = true; render(); setTimeout(() => { S.busy = false; toast('error', "Couldn't save the access rules.", 'The server did not answer. Your choices are kept.'); render(); }, 600); return 'skip'; }
      S.menu = null; openPreview(); return 'skip';
    },
    pvretry: () => { S.pvKind = S.pvKind === 'error' ? 'auto' : S.pvKind; openPreview(); return 'skip'; },
    confirmsave: () => { S.dlg = null; commit(); return 'skip'; },
    dlgx: () => { S.dlg = null; }, scrim: () => 'skip', dlg: (k) => { S.dlg = k; },
    confirmdelete: () => { S.dlg = null; S.rolesError = true; },
    rolesel: (id) => { S.rolesSel = +id; S.rolesError = false; },
    sort: (k) => { const c = COLS.find((x) => x.sort === k); S.sort = S.sort.key === k ? { key: k, dir: S.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: c && c.first === 'desc' ? 'desc' : 'asc' }; },
    strip: (k) => { const d = stripDefs().find((x) => x[0] === k); S.f = Object.assign({ name: '', form: '', access: '', status: 'active' }, d[3]); },
    clear: () => { S.f = { name: '', form: '', access: '', status: 'active' }; S.scene = S.scene === 'allopen' ? 'allopen' : S.scene; },
    retry: () => { if (S.view === 'list') S.scene = 'normal'; else S.state = 'ready'; },
    reload: () => { S.state = 'ready'; S.conflict = false; DRAFT = null; },
    toastx: (id) => { S.toasts = S.toasts.filter((t) => t.id !== +id); drawToasts(); return 'skip'; },
  };
  document.addEventListener('click', (e) => {
    const sc = e.target.closest('.scrim'); if (sc && e.target === sc && S.dlg) { S.dlg = null; render(); return; }
    const el = e.target.closest('[data-a]'); if (!el) { if (S.menu && S.menu !== 'event' && !e.target.closest('.ddf')) { S.menu = null; render(); } return; }
    e.preventDefault(); const [name, ...args] = el.getAttribute('data-a').split('|'); const fn = acts[name]; if (!fn) return; hideTip();
    if (fn(...args) !== 'skip') render();
  });
  document.addEventListener('change', (e) => {
    const f = e.target.getAttribute && e.target.getAttribute('data-f'); if (f) { S.f[f] = e.target.value; render(); return; }
    const s = e.target.getAttribute && e.target.getAttribute('data-s'); if (s) { const u = new URL(location.href); u.searchParams.set(s, e.target.value); u.searchParams.set('guide', '1'); location.href = u.toString(); }
  });
  document.addEventListener('input', (e) => { if (e.target.getAttribute && e.target.getAttribute('data-f') === 'name') { S.f.name = e.target.value; const pos = e.target.selectionStart; render(); const n = document.querySelector('[data-f="name"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (S.dlg) { S.dlg = null; render(); } else if (S.menu) { S.menu = null; render(); } } });

  /* a dialog that was asked for on load needs its data */
  if (S.dlg === 'confirm') {
    const t = cur(); const A = DRAFT || t.access;
    if (S.pvKind === 'loading') S.pvState = 'loading'; else if (S.pvKind === 'error') S.pvState = 'error';
    else S.pv = S.pvKind === 'auto' ? computePreview(t, t.access, { view: effView(A), edit: A.edit, assign: A.assign }) : clone(FORCED[S.pvKind] || FORCED.hide);
  }
  render();
})();
