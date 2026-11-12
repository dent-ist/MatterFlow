/* Vendor Management mockup: tiny renderer. No framework, no network. Nothing saves. State lives in the page only. */
(function () {
  const D = window.MF;
  const $root = document.getElementById('root');
  const qs = new URLSearchParams(location.search);
  if (qs.get('chrome') === '0') document.body.classList.add('nochrome');

  /* ---------- screens (the mockup guide lists these; the address hash picks one) ---------- */
  const SCREENS = [
    ['Vendors', [
      ['vendors', 'Vendor list', { page: 'vendors' }],
      ['vendor-filters', 'Vendor list, filter open', { page: 'vendors', menu: 'svc' }],
      ['vendor-view', 'Vendor dialog: Overview (view mode)', { page: 'vendors', drawer: 'v4', dtab: 'overview' }],
      ['vendor-contacts', 'Vendor dialog: Contacts and notes', { page: 'vendors', drawer: 'v1', dtab: 'contacts' }],
      ['vendor-matters', 'Vendor dialog: Matters', { page: 'vendors', drawer: 'v1', dtab: 'matters' }],
      ['vendor-edit', 'Vendor dialog: Edit mode (Overview becomes the form)', { page: 'vendors', drawer: 'v1', dtab: 'overview', vedit: true }],
      ['vendor-new', 'New Vendor dialog', { page: 'vendors', dialog: 'newVendor' }],
      ['vendor-note', 'Contacts: note form inline in the row', { page: 'vendors', drawer: 'v4', dtab: 'contacts', vnote: 'p13' }],
      ['vendor-add-contact', 'Contacts: Add Contact inline', { page: 'vendors', drawer: 'v1', dtab: 'contacts', ac: true, pp: { open: true, q: '' } }],
      ['vendor-delete-inline', 'Vendor dialog: Delete confirm in the footer', { page: 'vendors', drawer: 'v6', dtab: 'overview', vdel: true }],
      ['vendor-delete', 'Delete Vendor from the list row menu (allowed)', { page: 'vendors', dialog: 'deleteVendor', dv: 'v6' }],
      ['vendor-delete-blocked', 'Delete Vendor from the list row menu (blocked)', { page: 'vendors', dialog: 'deleteVendor', dv: 'v1' }],
    ]],
    ['Matter', [
      ['matter-summary', 'Summary: 7 team, 6 vendors (side column)', { page: 'matterSummary' }],
      ['matter-summary-collapsed', 'Summary: both panels collapsed', { page: 'matterSummary', coll: { team: true, vendors: true } }],
      ['matter-summary-one', 'Summary: one vendor', { page: 'matterSummary', mid: 'm2' }],
      ['matter-summary-none', 'Summary: no vendors', { page: 'matterSummary', mid: 'm3' }],
      ['matter-team-all', 'Team: Show All (read only)', { page: 'matterSummary', dialog: 'listDlg', ld: { kind: 'team', edit: false } }],
      ['matter-vendors-all', 'Vendors: Show All (read only)', { page: 'matterSummary', dialog: 'listDlg', ld: { kind: 'vendors', edit: false } }],
      ['matter-team-edit', 'Edit Team: list plus empty row', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'team' } }],
      ['matter-team-search', 'Edit Team: typing "ma" in the empty row', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'team', q: 'ma', open: true } }],
      ['matter-team-filled', 'Edit Team: several people added in a row', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'team', add: [['p9', 'Vendor Contact'], ['p15', '']], rm: 1 } }],
      ['matter-team-similar', 'Edit Team: near-duplicate hint', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'team', q: 'Laura Whitfeld', open: true } }],
      ['matter-team-nomatch', 'Edit Team: no match, Create offered', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'team', q: 'Dana Whitaker', open: true } }],
      ['matter-team-create', 'Edit Team: inline new person form', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'team', q: 'Dana Whitaker', form: { first: 'Dana', last: 'Whitaker' } } }],
      ['matter-vendors-edit', 'Edit Vendors: list plus empty row', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'vendors' } }],
      ['matter-vendors-search', 'Edit Vendors: typing "pa"', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'vendors', q: 'pa', open: true } }],
      ['matter-vendors-warn', 'Edit Vendors: Blacklisted picked, tick needed', { page: 'matterSummary', dialog: 'editDlg', te: { kind: 'vendors', add: ['v9', 'v4'] } }],
    ]],
    ['People', [
      ['people', 'People page', { page: 'people' }],
      ['person-new', 'New Person dialog (external)', { page: 'people', dialog: 'personEdit', pe: 'new' }],
      ['person-user', 'Edit Person (system user, locked fields)', { page: 'people', dialog: 'personEdit', pe: 'p1' }],
    ]],
    ['Permissions and no-permission states', [
      ['permissions', 'Role permission matrix', { page: 'permissions' }],
      ['noperm-summary', 'Summary: what each missing permission does', { page: 'without' }],
      ['noperm-hidden', 'No Vendor.View: nav hidden, address blocked', { page: 'vendors', persona: 'none' }],
      ['noperm-matter', 'No Vendor.View: Vendors panel hidden', { page: 'matterSummary', persona: 'none' }],
      ['noperm-readonly', 'Vendor.View only: read-only vendor dialog', { page: 'vendors', persona: 'ro', drawer: 'v1', dtab: 'contacts' }],
      ['noperm-link', 'No Vendor.Link: Edit disabled, reason shown', { page: 'matterSummary', persona: 'ro' }],
      ['noperm-people', 'No People.Manage: Create disabled, reason shown', { page: 'matterSummary', persona: 'ro', dialog: 'editDlg', te: { kind: 'team', q: 'Dana Whitaker', open: true } }],
    ]],
  ];
  const FLAT = SCREENS.flatMap((g) => g[1]);

  const blank = () => ({ page: 'vendors', drawer: null, dtab: 'overview', vedit: false, vnote: null, ac: false, vdel: false, dialog: null, dv: null, dctx: null, menu: null, mvEmpty: false,
    f: { q: '', cat: 'all', svc: [], area: [] },
    pk: { q: '', cat: 'all', svc: [], area: [], sel: [], ack: false },
    mid: 'm1', coll: { team: false, vendors: false }, te: null, ld: { kind: 'team', edit: false }, pp: { open: false, q: '' }, tm: { newOpen: false, picked: null, ptype: 'External' }, pe: 'new', pf: { q: '', type: 'all' }, noteFlag: null, noteSeg: null, toast: null,
    cvSel: { cat: 'Preferred', svc: ['eDiscovery', 'Review', 'Forensic'], area: ['US', 'EU'] }, keep: null });
  let S = Object.assign(blank(), { persona: qs.get('as') || 'full', guide: false });

  function applyScreen(id) {
    const hit = FLAT.find((x) => x[0] === id) || FLAT[0];
    const persona = hit[2].persona || (qs.get('as') || 'full');
    const keepGuide = S.guide;
    S = Object.assign(blank(), { persona, guide: keepGuide, screen: hit[0] });
    const o = hit[2];
    Object.keys(o).forEach((k) => {
      if (k === 'persona') return;
      if (k === 'drawer') S.drawer = o[k];
      else if (k === 'pk') S.pk = Object.assign(S.pk, o.pk);
      else if (k === 'pp') S.pp = Object.assign(S.pp, o.pp);
      else if (k === 'tm') S.tm = Object.assign(S.tm, o.tm);
      else if (k === 'ld') S.ld = o.ld;
      else if (k === 'te') { initTE(o.te.kind); const t = S.te; if (o.te.q) t.q = o.te.q; t.open = !!o.te.open; if (o.te.rm) { t.rows.splice(o.te.rm, 1); t.removed = 1; } (o.te.add || []).forEach((x) => { if (o.te.kind === 'team') t.rows.push({ pid: x[0], title: x[1] }); else t.rows.push({ vid: x, ack: false }); }); if (o.te.form) t.form = o.te.form; }
      else S[k] = o[k];
    });
    if (hit[0] === 'vendor-note') S.noteFlag = 'DNH';
    if (hit[0] === 'vendor-edit') S.cvSel = { cat: 'Preferred', svc: D.vendor('v1').svc.slice(), area: D.vendor('v1').area.slice() };
    if (hit[0] === 'vendor-new') S.cvSel = { cat: 'Preferred', svc: [], area: [] };
    if (hit[0] === 'matter-team-add' || hit[0] === 'noperm-people') S.tm.picked = null;
    render();
  }

  /* ---------- helpers ---------- */
  const P = () => D.PERSONAS[S.persona];
  const ini = (p) => (p.first[0] + p.last[0]).toUpperCase();
  const pname = (p) => p.first + ' ' + p.last;
  const ic = (n) => '<i class="pi pi-' + n + '" aria-hidden="true"></i>';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const av = (p, sm) => '<span class="avatar ' + (p.type === 'int' ? '' : 'avatar--ext') + (sm ? ' avatar--sm' : '') + '" aria-hidden="true">' + ini(p) + '</span>';
  const catChip = (c) => c === 'Preferred' ? '<span class="chip chip--ok">' + ic('verified') + 'Preferred</span>' : '<span class="chip chip--bad">' + ic('ban') + 'Blacklisted</span>';
  const typeChip = (p) => p.user ? '<span class="chip chip--info">' + ic('user') + 'System User</span>' : p.type === 'int' ? '<span class="chip chip--info">' + ic('building-columns') + 'Internal</span>' : '<span class="chip chip--off">' + ic('globe') + 'External</span>';
  const flagChip = (f) => f === 'DNH' ? '<span class="chip chip--bad">' + ic('ban') + 'Do Not Hire</span>' : f === 'REC' ? '<span class="chip chip--ok">' + ic('thumbs-up') + 'Recommended</span>' : '';
  const tagsShort = (arr, maxChars) => {
    if (arr.length === 0) return '<span class="muted">None</span>';
    let n = 0, used = 0;
    while (n < arr.length && (n === 0 || used + arr[n].length <= maxChars)) { used += arr[n].length; n++; }
    return arr.slice(0, n).map((x) => '<span class="tag">' + esc(x) + '</span>').join('') + (arr.length > n ? '<span class="cnt" title="' + esc(arr.slice(n).join(', ')) + '">+' + (arr.length - n) + '</span>' : '');
  };
  const tagsAll = (arr, cls) => arr.length === 0 ? '<span class="muted">None</span>' : '<span class="tags">' + arr.map((x) => '<span class="tag ' + (cls || '') + '">' + esc(x) + '</span>').join('') + '</span>';
  const btn = (label, a, o) => { o = o || {}; return '<button class="btn ' + (o.cls || '') + '" data-a="' + a + '"' + (o.dis ? ' disabled' : '') + (o.aria ? ' aria-label="' + o.aria + '"' : '') + '>' + (o.icon ? ic(o.icon) : '') + (label || '') + '</button>'; };
  const iconBtn = (icon, a, label) => '<button class="btn btn--icon" data-a="' + a + '" aria-label="' + label + '" title="' + label + '">' + ic(icon) + '</button>';
  const contactsOf = (v) => v.contacts.map((c) => Object.assign({}, c, { p: D.person(c.pid) }));
  const flagged = (v, f) => v.contacts.filter((c) => c.flag === f).length;

  function vendorMatch(v, f) {
    const q = f.q.trim().toLowerCase();
    if (q && !(v.name + ' ' + v.site + ' ' + v.svc.join(' ') + ' ' + v.area.join(' ') + ' ' + v.ai.join(' ')).toLowerCase().includes(q)) return false;
    if (f.cat !== 'all' && v.cat !== f.cat) return false;
    if (f.svc.length && !f.svc.some((s) => v.svc.includes(s))) return false;
    if (f.area.length && !f.area.some((s) => v.area.includes(s))) return false;
    return true;
  }
  function dd(id, pre, kind, value, items, sel, cls) {
    const open = S.menu === id;
    let text;
    if (kind === 'single') text = value === 'all' ? 'All' : value;
    else text = sel.length === 0 ? 'All' : sel[0] + (sel.length > 1 ? ' +' + (sel.length - 1) : '');
    const li = items.map((it) => {
      const on = kind === 'single' ? value === it : sel.includes(it);
      const lbl = it === 'all' ? 'All ' + ({ Category: 'Categories', Service: 'Services', Area: 'Areas' })[pre] : it;
      return '<button role="menuitemcheckbox" aria-checked="' + on + '" data-a="ddset|' + id + '|' + it + '">' + (kind === 'single' ? '<span class="tick">' + (on ? ic('check') : '') + '</span>' : '<span class="box">' + (on ? ic('check') : '') + '</span>') + esc(lbl) + '</button>';
    }).join('');
    const extra = kind === 'multi' && sel.length ? '<button data-a="ddset|' + id + '|__clear"><span class="tick"></span>Clear Selection</button>' : '';
    return '<div class="dd ' + (cls || '') + '"><button aria-haspopup="menu" aria-expanded="' + open + '" data-a="menu|' + id + '"><span class="pre">' + pre + ':</span> ' + esc(text) + ic('chevron-down') + '</button>' + (open ? '<div class="dd-list" role="menu">' + li + extra + '</div>' : '') + '</div>';
  }

  /* ---------- shell ---------- */
  function nav() {
    const pe = P(); const cur = S.page;
    const live = (go, icon, label, on, extra, cls) => '<a href="#' + go + '" class="' + (cls || '') + '"' + (on ? ' aria-current="page"' : '') + '>' + ic(icon) + label + (extra || '') + '</a>';
    const dead = (icon, label, cls) => '<a href="#" data-dead="1" class="' + (cls || '') + '">' + ic(icon) + label + '</a>';
    const newTag = '<span class="new mk-only">NEW</span>';
    return '<nav class="nav" aria-label="Main"><div class="logo"><i>MF</i>MatterFlow</div>' +
      dead('chart-bar', 'Dashboard') + dead('briefcase', 'My Matters') + dead('list-check', 'My Work') + dead('building', 'Clients') +
      live('matter-summary', 'folder', 'Matters', cur.startsWith('matter')) + dead('sitemap', 'Projects', 'sub') + dead('database', 'Assets', 'sub') +
      (pe.view ? live('vendors', 'truck', 'Vendors', cur === 'vendors', newTag) : '') +
      (pe.pview ? live('people', 'address-book', 'People', cur === 'people', newTag) : '') +
      dead('users', 'Pod Work') + dead('list', 'Task Queue') + dead('chart-bar', 'Reports') +
      '<div class="sec">Administration</div>' + live('permissions', 'users', 'Users', cur === 'permissions') +
      dead('sliders-h', 'Task Types') + dead('list', 'Lists') + dead('database', 'Asset Types') + dead('cog', 'Settings') + '</nav>';
  }
  function top() {
    const pe = P();
    return '<header class="top"><div class="gs">' + ic('search') + 'Search clients, matters, tasks, assets...<kbd>Ctrl+K</kbd></div><span class="chip chip--risk mk-only" style="margin-left:8px">Mockup: nothing saves</span><span class="sp"></span>' +
      '<button class="btn btn--primary">' + ic('plus') + 'New Task</button><button class="btn btn--icon" aria-label="Notifications">' + ic('bell') + '</button>' +
      '<span class="avatar" title="' + pe.name + '">' + pe.ini + '</span></header>';
  }
  function head(icon, title, cnt, actions, desc) {
    return '<div class="ph"><span class="tile">' + ic(icon) + '</span><h1>' + title + '</h1>' + (cnt != null ? '<span class="cnt">' + cnt + '</span>' : '') + '<span class="sp"></span>' + (actions || '') + '</div>' + (desc ? '<p class="pdesc">' + desc + '</p>' : '');
  }

  /* ---------- Vendors page ---------- */
  function vendorsPage() {
    const pe = P();
    if (!pe.view) return noAccess('Vendors', 'Vendor.View');
    const f = S.f; const rows = D.VENDORS.filter((v) => vendorMatch(v, f)).sort((a, b) => a.name.localeCompare(b.name));
    const filtered = f.q || f.cat !== 'all' || f.svc.length || f.area.length;
    const act = pe.manage ? btn('New Vendor', 'dlg|newVendor', { cls: 'btn--primary', icon: 'plus' }) : '';
    const body = rows.map((v) => {
      const dnh = flagged(v, 'DNH');
      return '<tr data-a="drawer|' + v.id + '" class="' + (S.drawer === v.id ? 'sel' : '') + '" style="cursor:pointer"><td><span class="two"><button class="btn btn--name" data-a="drawer|' + v.id + '" title="' + esc(v.name) + '">' + esc(v.name) + '</button></span><span class="two mono xs" style="font-family:var(--mf-font-mono)">' + esc(v.site) + '</span></td>' +
        '<td>' + catChip(v.cat) + '</td><td>' + tagsShort(v.svc, 22) + '</td><td>' + tagsShort(v.area, 9) + '</td>' +
        '<td class="num">' + (dnh ? '<span title="' + dnh + ' contact flagged Do Not Hire" style="color:var(--mf-danger);margin-right:6px">' + ic('flag') + '</span>' : '') + v.contacts.length + '</td><td class="num">' + v.links.length + '</td><td>' + v.updated + '</td>' +
        (pe.manage ? '<td class="act"><button class="btn btn--icon" data-a="menu|row:' + v.id + '" aria-label="Actions for ' + esc(v.name) + '" aria-haspopup="menu">' + ic('ellipsis-h') + '</button>' +
          (S.menu === 'row:' + v.id ? '<div class="menu" role="menu"><button data-a="edit|' + v.id + '">' + ic('pencil') + 'Edit Vendor</button><hr style="border:0;border-top:1px solid var(--mf-border);margin:4px 0"><button class="dng" data-a="del|' + v.id + '">' + ic('trash') + 'Delete Vendor</button></div>' : '') + '</td>' : '') + '</tr>';
    }).join('');
    return '<main class="main">' + head('truck', 'Vendors', D.VENDORS.length, act, 'Firms the team hires for eDiscovery work. Preferred and Blacklisted vendors are both listed; Blacklisted ones carry a warning wherever they appear.') +
      '<div class="toolbar"><label class="search">' + ic('search') + '<input data-keep="vq" value="' + esc(f.q) + '" placeholder="Search vendors" aria-label="Search vendors"></label>' +
      dd('cat', 'Category', 'single', f.cat, ['all', 'Preferred', 'Blacklisted'], []) + dd('svc', 'Service', 'multi', '', D.SERVICES, f.svc) + dd('area', 'Area', 'multi', '', D.AREAS, f.area) +
      (filtered ? '<button class="btn btn--text" data-a="clearf">Clear Filters</button>' : '') + '<span class="sp"></span><span class="sm muted">' + rows.length + ' of ' + D.VENDORS.length + ' vendors</span></div>' +
      '<div class="frame"><div class="scroll">' + (rows.length ? '<table><colgroup><col><col style="width:132px"><col style="width:250px"><col style="width:150px"><col style="width:96px"><col style="width:96px"><col style="width:112px">' + (pe.manage ? '<col style="width:var(--mf-col-actions-w)">' : '') + '</colgroup>' +
        '<thead><tr><th>Vendor ' + ic('arrow-up') + '</th><th>Category</th><th>Services</th><th>Areas</th><th class="num">Contacts</th><th class="num">Matters</th><th>Updated</th>' + (pe.manage ? '<th class="act"><span class="sr">Actions</span></th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table>'
        : '<div class="state" style="height:100%">' + ic('search') + '<p>No vendors match these filters.</p><small>Change the search or clear the filters.</small><button class="btn" data-a="clearf">Clear Filters</button></div>') + '</div>' +
      '<div class="pager"><span>1 to ' + rows.length + ' of ' + rows.length + '</span><span class="sp"></span><span>Rows per page: 25</span></div></div></main>';
  }
  function noAccess(what, perm) {
    return '<main class="main">' + head('lock', 'Access Denied', null, '') + '<div class="frame"><div class="state">' + ic('lock') + '<p>You do not have access to ' + what + '.</p><small>Your role does not include <code>' + perm + '</code>. If you need it, ask an administrator to add it to your role. The ' + what + ' menu item is hidden for you, so this page only appears if you open its address directly.</small><a class="btn" href="#matter-summary">Go to Matters</a></div></div></main>';
  }

  /* ---------- Vendor dialog (view mode with tabs; Edit switches Overview to the form in place) ---------- */
  function vendorView() {
    const v = D.vendor(S.drawer); const pe = P(); const t = S.dtab; const ed = S.vedit;
    const cons = contactsOf(v);
    const tabs = [['overview', 'Overview', 'info-circle', ''], ['contacts', 'Contacts', 'users', ' (' + v.contacts.length + ')'], ['matters', 'Matters', 'folder', ' (' + v.links.length + ')']];
    let body = '';
    if (ed) {
      body = vendorFormBody(false, v.id);
    } else if (t === 'overview') {
      body = (v.cat === 'Blacklisted' ? '<div class="banner banner--bad" role="note" style="margin-bottom:16px">' + ic('ban') + '<span class="txt"><b>Blacklisted.</b> This vendor stays in lists and can still be linked to a matter, but every place it appears carries this warning.</span></div>' : '') +
        '<dl class="facts"><dt>Category</dt><dd>' + catChip(v.cat) + '</dd><dt>Website</dt><dd><a class="link mono" style="font-family:var(--mf-font-mono)" href="#" data-a="noop">https://' + esc(v.site) + '</a> ' + ic('external-link') + '</dd>' +
        '<dt>Services</dt><dd>' + tagsAll(v.svc) + '</dd><dt>Areas</dt><dd>' + tagsAll(v.area, 'tag--teal') + '</dd>' +
        '<dt>Tech AI</dt><dd>' + (v.ai.length ? v.ai.map((a) => '<div class="ai">' + ic('microchip-ai') + esc(a) + '</div>').join('') : '<span class="muted">None reported</span>') + '</dd>' +
        '<dt>Note</dt><dd>' + esc(v.note) + '</dd><dt>Last Updated</dt><dd>' + v.updated + '</dd></dl>';
    } else if (t === 'contacts') {
      const acForm = S.ac ? '<div class="inline-new" style="margin-bottom:12px"><h3>' + ic('user-plus') + 'Add Contact <span class="sm muted" style="font-weight:400">Pick a person from People, or type a new name.</span></h3>' +
        (S.tm.newOpen ? newPersonInline('added as a contact') : (S.tm.picked ? pickedBox(D.person(S.tm.picked)) + '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn--text" data-a="acx">Cancel</button><button class="btn" data-a="acsave">Add Contact</button></div>' :
          '<div class="field"><div class="inp" data-a="ppopen">' + ic('search') + '<input data-keep="pp" value="' + esc(S.pp.q) + '" placeholder="Search People by name, email or company" role="combobox" aria-expanded="' + S.pp.open + '" aria-label="Person" autocomplete="off">' + ic('chevron-down') + '</div>' + (S.pp.open ? pickerHtml(v.contacts.map((c) => c.pid), 'Already a Contact').replace('class="cbx"', 'class="cbx" style="position:static;max-height:230px;margin-top:6px"') : '') + '</div><div style="display:flex;justify-content:flex-end"><button class="btn btn--text" data-a="acx">Cancel</button></div>')) + '</div>' : '';
      body = '<div class="sect"><h3>Contacts</h3><span class="cnt">' + v.contacts.length + '</span><span class="sp"></span>' + (pe.manage && !S.ac ? btn('Add Contact', 'ac', { icon: 'user-plus' }) : '') + '</div>' + acForm +
        (cons.length ? '<div>' + cons.map((c) => {
          const p = c.p; const open = S.vnote === p.id; const fl = S.noteFlag == null ? c.flag || '' : S.noteFlag;
          const form = open ? '<div class="inline-new" style="grid-column:1/-1;margin-top:4px"><h3>' + ic('flag') + 'Contact Note <span class="sm muted" style="font-weight:400">' + esc(pname(p)) + '</span></h3><div class="fgrid"><div class="field full"><span class="lbl">Note Flag</span><span class="seg" role="group" aria-label="Note flag">' + [['', 'No Note'], ['REC', 'Recommended'], ['DNH', 'Do Not Hire']].map((o) => '<button aria-pressed="' + (fl === o[0]) + '" data-a="flag|' + o[0] + '">' + (o[0] === 'DNH' ? ic('ban') : o[0] === 'REC' ? ic('thumbs-up') : '') + o[1] + '</button>').join('') + '</span></div>' +
            '<div class="field"><label for="nd">Reported Date <span class="req">(required)</span></label><div class="inp"><input id="nd" value="' + (c.date || D.TODAY) + '">' + ic('calendar') + '</div></div><div class="field"><label for="nb">Reported By <span class="req">(required)</span></label><div class="inp">' + ic('search') + '<input id="nb" value="' + esc(c.by || P().name) + '"></div></div>' +
            '<div class="field full"><label for="nn">Note <span class="req">(required)</span></label><textarea id="nn" class="inp" rows="3">' + esc(c.note || '') + '</textarea><div class="help">Everyone who can view vendors can read this.</div></div></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn--text" data-a="vnote|">Cancel</button><button class="btn" data-a="save|Save Note">Save Note</button></div></div>' : '';
          return '<div class="contact"><div class="who">' + av(p) + '<div style="min-width:0"><div class="nm">' + pname(p) + ' <span class="muted" style="font-weight:400">' + esc(p.title) + '</span></div><div class="sm muted">' + esc(p.email) + '</div></div></div>' +
            '<div style="display:flex;align-items:center;gap:8px">' + (c.flag ? flagChip(c.flag) : '<span class="sm muted">No note</span>') + (pe.manage && !open ? '<button class="btn btn--text" aria-expanded="false" data-a="vnote|' + p.id + '">' + (c.flag ? 'Edit Note' : 'Add Note') + '</button>' : '') + '</div>' +
            (c.flag && !open ? '<div class="note ' + (c.flag === 'DNH' ? 'bad' : 'ok') + '"><div class="hd">' + ic('flag') + 'Reported ' + c.date + ' by ' + esc(c.by) + '</div>' + esc(c.note) + '</div>' : '') + form + '</div>';
        }).join('') + '</div>' : '<div class="state">' + ic('users') + '<p>No contacts yet.</p><small>Add the people at this vendor you deal with. Pick them from People, or add a new person on the way.</small></div>');
    } else {
      body = '<div class="sect"><h3>Matters</h3><span class="cnt">' + v.links.length + '</span></div>' +
        (v.links.length ? '<div class="frame" style="flex:none;box-shadow:none"><table><colgroup><col style="width:110px"><col><col style="width:130px"><col style="width:96px"><col style="width:130px"></colgroup><thead><tr><th>CM Number</th><th>Matter</th><th>Client</th><th>Linked</th><th>Linked By</th></tr></thead><tbody>' +
          v.links.map((l) => { const m = D.matter(l[0]); return '<tr><td><a class="link mono" style="font-family:var(--mf-font-mono)" href="#matter-summary">' + m.cm + '</a></td><td title="' + esc(m.name) + '">' + esc(m.name) + '</td><td>' + esc(m.client) + '</td><td>' + l[1] + '</td><td>' + esc(l[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          '<p class="sm muted" style="margin:12px 0 0">Vendors are linked from the matter: open a matter, Summary, then Edit on the Vendors panel.</p>'
          : '<div class="state">' + ic('folder') + '<p>Not linked to any matter.</p><small>Link it from a matter\'s Summary tab. A vendor with no matters can be deleted.</small></div>');
    }
    let foot;
    if (S.vdel) foot = '<span class="mid" style="padding:0;color:var(--mf-text)"><b>Delete ' + esc(v.name) + '?</b> ' + (v.links.length ? 'It is linked to ' + v.links.length + ' matter' + (v.links.length > 1 ? 's' : '') + ' and cannot be deleted. Unlink it first, or set its category to Blacklisted.' : 'Its contacts stay in People. This cannot be undone.') + '</span><button class="btn" data-a="vdel">' + (v.links.length ? 'Close' : 'Keep Vendor') + '</button>' + (v.links.length ? '' : '<button class="btn btn--solid-danger" data-a="save|Delete Vendor">Delete Vendor</button>');
    else if (ed) foot = '<button class="btn" data-a="vedit">Cancel</button><span class="sp"></span><button class="btn btn--primary" data-a="save|Save Changes">Save Changes</button>';
    else if (pe.manage) foot = '<button class="btn" data-a="vdel">' + ic('trash') + 'Delete Vendor</button><span class="sp"></span><button class="btn" data-a="close">Close</button><button class="btn btn--primary" data-a="vedit">' + ic('pencil') + 'Edit Vendor</button>';
    else foot = '<span class="mid" style="padding:0">Read only. Editing vendors needs the Vendor.Manage permission.</span><button class="btn btn--primary" data-a="close">Close</button>';
    return '<div class="scrim" data-a="close"><div class="dlg dlg--lg" style="height:min(640px,90vh)" role="dialog" aria-modal="true" aria-label="Vendor ' + esc(v.name) + '" data-stop="1"><header><div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px"><h2>' + (ed ? 'Edit Vendor' : esc(v.name)) + '</h2>' + (ed ? '<span class="subt" style="display:inline">' + esc(v.name) + '</span>' : catChip(v.cat)) + '</div>' + iconBtn('times', 'close', 'Close') + '</header>' +
      '<div class="tabs" role="tablist" style="padding:0 8px;flex:none">' + tabs.map((x) => '<button class="tab" role="tab" ' + (ed && x[0] !== 'overview' ? 'disabled aria-disabled="true" style="color:var(--mf-text-disabled);cursor:not-allowed" ' : '') + 'aria-selected="' + (t === x[0]) + '" data-a="dtab|' + x[0] + '">' + ic(x[2]) + x[1] + x[3] + '</button>').join('') + '</div>' +
      '<div class="bd">' + body + '</div><footer>' + foot + '</footer></div></div>';
  }

  /* ---------- dialogs ---------- */
  function dialog(title, sub, size, body, footer, vis) {
    return '<div class="scrim" data-a="close"><div class="dlg ' + (size || '') + '" role="dialog" aria-modal="true" aria-label="' + title + '" data-stop="1"><header><div style="flex:1;min-width:0"><h2>' + title + '</h2>' + (sub ? '<span class="subt">' + sub + '</span>' : '') + '</div>' + iconBtn('times', 'close', 'Close') + '</header><div class="bd" ' + (vis ? 'style="overflow:visible"' : '') + '>' + body + '</div><footer>' + footer + '</footer></div></div>';
  }
  const cancelSave = (label, extra) => '<button class="btn" data-a="close">Cancel</button>' + (extra || '<span class="sp"></span>') + '<button class="btn btn--primary" data-a="save|' + label + '">' + label + '</button>';

  function fchips(group, all, sel) {
    return '<div class="tags" role="group">' + all.map((x) => '<button class="fchip" aria-pressed="' + sel.includes(x) + '" data-a="cv|' + group + '|' + x + '">' + (sel.includes(x) ? ic('check') : '') + esc(x) + '</button>').join('') + '</div>';
  }
  function vendorFormBody(isNew, vid) {
    const v = isNew ? { name: '', site: '', ai: [], note: '' } : D.vendor(vid);
    const c = S.cvSel;
    const body = '<div class="fgrid">' +
      '<div class="field"><label for="vn">Name <span class="req">(required)</span></label><div class="inp"><input id="vn" value="' + esc(v.name) + '"></div></div>' +
      '<div class="field"><label for="vw">Website</label><div class="inp"><input id="vw" value="' + (v.site ? 'https://' + esc(v.site) : '') + '" placeholder="https://"></div></div>' +
      '<div class="field full"><span class="lbl">Category <span class="req">(required)</span></span><span class="seg" role="group" aria-label="Category"><button aria-pressed="' + (c.cat === 'Preferred') + '" data-a="cv|cat|Preferred">' + ic('verified') + 'Preferred</button><button aria-pressed="' + (c.cat === 'Blacklisted') + '" data-a="cv|cat|Blacklisted">' + ic('ban') + 'Blacklisted</button></span>' +
        '<div class="help">' + (c.cat === 'Blacklisted' ? 'Blacklisted vendors stay visible and show a warning whenever someone links them. Put the reason in Note.' : 'Preferred is the default for a vendor the firm is happy to use.') + '</div></div>' +
      '<div class="field full"><span class="lbl">Services</span>' + fchips('svc', D.SERVICES, c.svc) + '<div class="help">Pick every service the vendor offers. The list is kept in Administration, Lists.</div></div>' +
      '<div class="field full"><span class="lbl">Areas</span>' + fchips('area', D.AREAS, c.area) + '</div>' +
      '<div class="field full"><span class="lbl">Tech AI</span><div class="tags" style="margin-bottom:8px">' + (v.ai.map((a) => '<span class="tagrm">' + ic('microchip-ai') + esc(a) + '<button aria-label="Remove ' + esc(a) + '">' + ic('times') + '</button></span>').join('') || '<span class="sm muted">No AI systems added.</span>') + '</div>' +
        '<div style="display:flex;gap:8px"><div class="inp" style="max-width:420px"><input aria-label="Add an AI system or service" placeholder="AI system or service, for example Relativity aiR"></div><button class="btn">' + ic('plus') + 'Add</button></div></div>' +
      '<div class="field full"><label for="vt">Note</label><textarea id="vt" class="inp" rows="3">' + esc(v.note) + '</textarea></div>' +
      (isNew ? '<div class="banner full" style="grid-column:1/-1">' + ic('info-circle') + '<span class="txt">Contacts are added after the vendor is saved, on the Contacts tab of its detail panel.</span></div>' : '') + '</div>';
    return body;
  }
  function vendorDialog() { return dialog('New Vendor', '', 'dlg--lg', vendorFormBody(true), cancelSave('Create Vendor')); }
  /* person picker (used by Team panel and vendor Add Contact) */
  function pickerHtml(excl, tagFor) {
    const pe = P(); const q = S.pp.q.trim().toLowerCase();
    const list = D.PEOPLE.filter((p) => !q || (pname(p) + ' ' + p.email + ' ' + p.company + ' ' + p.title).toLowerCase().includes(q));
    const grp = (label, icon, arr) => arr.length ? '<div class="grp">' + ic(icon) + label + '</div>' + arr.map((p) => {
      const on = excl.includes(p.id);
      return '<button class="po" ' + (on ? 'disabled' : 'data-a="pick|' + p.id + '"') + '>' + av(p, true) + '<span class="txt"><span class="nm">' + pname(p) + '</span><span class="meta">' + esc(p.title) + ' &middot; ' + esc(p.company || p.email) + '</span></span>' + (on ? '<span class="chip chip--off">' + tagFor + '</span>' : '') + '</button>';
    }).join('') : '';
    const sys = list.filter((p) => p.user), intl = list.filter((p) => p.type === 'int' && !p.user), ext = list.filter((p) => p.type === 'ext');
    return '<div class="cbx" role="listbox">' + '<div class="list">' + grp('System Users', 'user', sys) + grp('Internal, No Login', 'building-columns', intl) + grp('External', 'globe', ext) + (list.length ? '' : '<div class="state" style="padding:16px">' + ic('search') + '<p>No one matches "' + esc(S.pp.q) + '".</p></div>') + '</div>' +
      '<div class="add">' + (pe.pmanage ? '<button class="po" data-a="newp"><span class="avatar avatar--sm" style="background:var(--mf-primary);color:#fff">' + ic('plus') + '</span><span class="txt"><span class="nm" style="color:var(--mf-link)">Add New Person' + (q ? ' "' + esc(S.pp.q) + '"' : '') + '</span><span class="meta">Saves to People and selects them here</span></span></button>'
        : '<div class="po" aria-disabled="true" style="color:var(--mf-text-disabled)"><span class="avatar avatar--sm" style="background:var(--mf-surface-alt);color:var(--mf-text-disabled)">' + ic('lock') + '</span><span class="txt"><span class="nm">Add New Person (not available)</span><span class="meta">Needs the People.Manage permission. Ask an administrator, or ask someone who has it to add the person.</span></span></div>') + '</div></div>';
  }
  function pickedBox(p) {
    return '<div class="picked">' + av(p) + '<div style="flex:1;min-width:0"><div style="font-weight:600">' + pname(p) + ' ' + typeChip(p).replace('class="chip', 'style="height:20px;margin-left:6px" class="chip') + '</div><div class="sm muted">' + esc(p.title) + (p.company ? ' &middot; ' + esc(p.company) : '') + ' &middot; ' + esc(p.email) + '</div></div><button class="btn btn--text" data-a="unpick">Change</button></div>';
  }
  function newPersonInline(forWhat) {
    return '<div class="inline-new"><h3>' + ic('user-plus') + 'New Person <span class="sm muted" style="font-weight:400">Saved to People and ' + forWhat + '</span></h3><div class="fgrid">' +
      '<div class="field"><label for="ni1">First Name <span class="req">(required)</span></label><div class="inp"><input id="ni1" value="Dana"></div></div>' +
      '<div class="field"><label for="ni2">Last Name <span class="req">(required)</span></label><div class="inp"><input id="ni2" value="Whitaker"></div></div>' +
      '<div class="field"><span class="lbl">Internal or External</span><span class="seg" role="group"><button aria-pressed="false" data-a="ptype|Internal">Internal</button><button aria-pressed="true" data-a="ptype|External">External</button></span></div>' +
      '<div class="field"><label for="ni3">Company Name</label><div class="inp"><input id="ni3" value="Whitaker Court Reporting"></div></div>' +
      '<div class="field"><label for="ni4">Email <span class="req">(required)</span></label><div class="inp"><input id="ni4" value="dana@whitakerreporting.example"></div></div>' +
      '<div class="field"><label for="ni5">Title or Role</label><div class="inp"><input id="ni5" value="Court Reporter"></div></div>' +
      '</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn--text" data-a="cancelnew">Cancel New Person</button><button class="btn" data-a="savenew">Create and Select</button></div></div>';
  }
  function deleteDialog() {
    const v = D.vendor(S.dv); const n = v.links.length;
    if (n) return dialog('Delete Vendor', '', 'dlg--sm', '<p><b>' + esc(v.name) + '</b> is linked to ' + n + ' matter' + (n > 1 ? 's' : '') + ' and cannot be deleted. Unlink it from each matter first. If the firm should stop using it, set its category to Blacklisted instead.</p>', '<span class="sp"></span><button class="btn btn--primary" data-a="close">Close</button>');
    return dialog('Delete Vendor', '', 'dlg--sm', '<p>Delete <b>' + esc(v.name) + '</b> and its ' + v.contacts.length + ' contact' + (v.contacts.length === 1 ? '' : 's') + '? The people stay in People. This cannot be undone.</p>', '<button class="btn" data-a="close">Cancel</button><button class="btn btn--solid-danger" data-a="save|Delete Vendor">Delete Vendor</button>');
  }

  function personDialog() {
    const isNew = S.pe === 'new'; const p = isNew ? { first: '', last: '', type: 'ext', title: '', email: '', company: '', comments: '' } : D.person(S.pe);
    const lock = !!p.user; const ro = lock ? ' readonly' : '';
    const body = (lock ? '<div class="banner" style="margin-bottom:16px">' + ic('lock') + '<span class="txt">This person is a system user. Name, email and Internal come from the user account; change them in <a class="link" href="#permissions">Administration, Users</a>. Title or Role and Comments can be edited here.</span></div>' : '') +
      '<div class="fgrid"><div class="field"><label for="p1">First Name <span class="req">(required)</span></label><div class="inp ' + (lock ? 'ro' : '') + '"><input id="p1" value="' + esc(p.first) + '"' + ro + '>' + (lock ? ic('lock') : '') + '</div></div>' +
      '<div class="field"><label for="p2">Last Name <span class="req">(required)</span></label><div class="inp ' + (lock ? 'ro' : '') + '"><input id="p2" value="' + esc(p.last) + '"' + ro + '>' + (lock ? ic('lock') : '') + '</div></div>' +
      '<div class="field"><span class="lbl">Internal or External</span><span class="seg" role="group"><button aria-pressed="' + (p.type === 'int') + '" ' + (lock ? 'disabled' : '') + '>Internal</button><button aria-pressed="' + (p.type === 'ext') + '" ' + (lock ? 'disabled' : '') + '>External</button></span><div class="help">' + (p.type === 'ext' ? 'External: works outside the firm, for example a client, a vendor or opposing counsel.' : 'Internal: works at the firm. Having a MatterFlow login is managed on the Users page.') + '</div></div>' +
      '<div class="field"><label for="p3">Title or Role</label><div class="inp"><input id="p3" value="' + esc(p.title) + '"></div></div>' +
      '<div class="field"><label for="p4">Email' + (p.type === 'ext' ? ' <span class="req">(required)</span>' : '') + '</label><div class="inp ' + (lock ? 'ro' : '') + '"><input id="p4" value="' + esc(p.email) + '"' + ro + '>' + (lock ? ic('lock') : '') + '</div></div>' +
      (p.type === 'ext' ? '<div class="field"><label for="p5">External Company Name</label><div class="inp"><input id="p5" value="' + esc(p.company) + '"></div></div>' : '') +
      '<div class="field full"><label for="p6">Comments</label><textarea id="p6" class="inp" rows="3">' + esc(p.comments) + '</textarea></div></div>';
    return dialog(isNew ? 'New Person' : 'Edit Person', isNew ? 'Added to the shared address book' : esc(pname(p)), '', body, cancelSave(isNew ? 'Create Person' : 'Save Changes'));
  }
  function overlays() {
    let h = '';
    if (S.drawer) h += vendorView();
    const d = S.dialog;
    if (d === 'newVendor') h += vendorDialog();
    else if (d === 'deleteVendor') h += deleteDialog();
    else if (d === 'listDlg') h += listDialog(); else if (d === 'editDlg') h += editDialog(); else if (d === 'personEdit') h += personDialog();
    if (S.toast) h += '<div class="toast" role="status"><b>' + S.toast + '</b></div>';
    return h;
  }

  /* ---------- matter Summary tab: Details at the left, Team and Vendors panels in a side column ---------- */
  const M = () => D.matter(S.mid);
  const vendorsOf = (mid) => D.VENDORS.filter((v) => v.links.some((l) => l[0] === mid)).sort((a, b) => (a.cat === b.cat ? a.name.localeCompare(b.name) : a.cat === 'Blacklisted' ? -1 : 1));
  const teamOf = (mid) => D.TEAMS[mid].map((t) => ({ t, p: D.person(t.pid) }));
  const cap = () => (window.innerHeight >= 900 ? 5 : 3);
  const lev = (a, b) => { const m = []; for (let i = 0; i <= a.length; i++) { m[i] = [i]; } for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  function matterShell(content) {
    const mt = M();
    const tabs = [['summary', 'Summary', 'home', ''], ['tasks', 'Tasks', 'check-square', ' (14)'], ['projects', 'Projects', 'folder', ' (2)'], ['assets', 'Assets', 'database', ' (9)'], ['productions', 'Productions', 'send', ' (3)'], ['notes', 'Notes', 'file-edit', ' (6)'], ['activities', 'Activities', 'history', '']];
    return '<main class="main"><div class="crumb"><a href="#matter-summary">Matters</a>' + ic('chevron-right').replace('pi ', 'pi xs ') + '<span class="cur">' + mt.cm + '</span></div>' +
      '<div class="ph"><span class="tile">' + ic('folder') + '</span><h1>' + esc(mt.name) + '</h1><span class="chip chip--ok">' + ic('check-circle') + 'Active</span><span class="sp"></span><button class="btn">' + ic('pencil') + 'Edit</button><button class="btn">' + ic('history') + 'Activity</button><button class="btn btn--primary">' + ic('plus') + 'New Task</button></div>' +
      '<div class="sub"><span class="mono" style="font-family:var(--mf-font-mono)">CM ' + mt.cm + '</span><span class="sep">|</span><span>Client: <a class="link" href="#matter-summary">' + esc(mt.client) + '</a></span><span class="sep">|</span><span>Primary PM: ' + pname(D.person(mt.pm)) + '</span></div>' +
      '<div class="tabs" role="tablist">' + tabs.map((x) => '<a class="tab" role="tab" href="#matter-summary" data-dead="1" aria-selected="' + (x[0] === 'summary') + '">' + ic(x[2]) + x[1] + x[3] + '</a>').join('') + '</div>' + content + '</main>';
  }
  function panel(key, title, n, extraChip, editBtn, rows, footer, emptyHtml) {
    const open = !S.coll[key];
    if (!n) return '<section class="card pnl pnl-empty" aria-label="' + title + '"><span class="pnl-t">' + title + '</span><span class="cnt">0</span>' + emptyHtml + '</section>';
    return '<section class="card pnl" aria-label="' + title + '"><div class="pnl-h"><button class="pnl-tg" aria-expanded="' + open + '" data-a="coll|' + key + '" aria-label="' + (open ? 'Collapse ' : 'Expand ') + title + '">' + ic(open ? 'chevron-down' : 'chevron-right') + '<span class="pnl-t">' + title + '</span><span class="cnt">' + n + '</span>' + (extraChip || '') + '</button>' + editBtn + '</div>' + (open ? '<ul class="bx-list">' + rows + '</ul>' + (footer || '') : '') + '</section>';
  }
  function panelTeam() {
    const rows = teamOf(S.mid), n = rows.length, c = cap();
    const li = rows.slice(0, c).map((r) => '<li class="pl-row">' + av(r.p, true) + '<span class="pl-tx"><b>' + pname(r.p) + '</b><span class="pl-sub" title="' + esc(r.t.title) + '">' + esc(r.t.title) + '</span></span>' + typeChip(r.p).replace('chip ', 'chip bx-chip ') + '</li>').join('');
    return panel('team', 'Team', n, '', '<button class="btn btn--text" data-a="ld|team|1">' + ic('pencil') + 'Edit</button>', li, n > c ? '<div class="bx-f"><button class="btn btn--text" data-a="ld|team|0">Show All ' + n + '</button></div>' : '', '<span class="sp"></span><span class="muted sm">No team members</span><button class="btn btn--text" data-a="ld|team|1">+ Add Member</button>');
  }
  function panelVendors() {
    const pe = P(); if (!pe.view) return '';
    const vs = vendorsOf(S.mid), n = vs.length, c = cap(), bl = vs.filter((v) => v.cat === 'Blacklisted');
    const li = vs.slice(0, c).map((v) => '<li class="pl-row pl-v ' + (v.cat === 'Blacklisted' ? 'bx-warn' : '') + '"><span class="bx-main"><button class="btn btn--name" data-a="goto|vendor-view" title="' + esc(v.name) + '">' + esc(v.name) + '</button></span>' + (flagged(v, 'DNH') ? '<span style="color:var(--mf-danger)" title="Contact flagged Do Not Hire">' + ic('flag') + '</span>' : '') + catChip(v.cat).replace('chip ', 'chip bx-chip ') + '</li>').join('');
    const edit = pe.link ? '<button class="btn btn--text" data-a="ld|vendors|1">' + ic('pencil') + 'Edit</button>' : '<button class="btn btn--text" disabled aria-disabled="true" aria-describedby="whylink" style="color:var(--mf-text-disabled);cursor:not-allowed">' + ic('pencil') + 'Edit</button>';
    const why = !pe.link ? '<div class="bx-f"><span class="why" id="whylink">' + ic('lock') + 'Needs Vendor.Link to change.</span><span class="sp"></span>' + (n > c ? '<button class="btn btn--text" data-a="ld|vendors|0">Show All ' + n + '</button>' : '') + '</div>' : (n > c ? '<div class="bx-f"><button class="btn btn--text" data-a="ld|vendors|0">Show All ' + n + '</button></div>' : '');
    return panel('vendors', 'Vendors', n, bl.length ? '<span class="chip chip--bad bx-chip" title="' + esc(bl.map((v) => v.name).join(', ')) + '">' + ic('exclamation-triangle') + bl.length + '</span>' : '', edit, li, why, '<span class="sp"></span><span class="muted sm">No vendors linked</span>' + (pe.link ? '<button class="btn btn--text" data-a="ld|vendors|1">+ Add Vendor</button>' : '<span class="why" id="whylink">' + ic('lock') + 'Needs Vendor.Link</span>'));
  }
  function summaryPage() {
    const mt = M(); const pr = D.person(mt.pm), sc = mt.sec ? D.person(mt.sec) : null;
    const tiles = [['Hard Drives', 'database', 'slate', 12], ['Email Sets', 'at', 'blue', 4], ['Cloud Sources', 'globe', 'teal', 6], ['Chat Exports', 'comments', 'violet', 3], ['Production Volumes', 'box', 'orange', 3]];
    const f = (l, v, wide) => '<div class="df ' + (wide ? 'wide' : '') + '"><span class="dl">' + l + '</span><span class="dv">' + v + '</span></div>';
    return matterShell('<ul class="ms-tiles">' + tiles.map((t) => '<li class="card ms-tile"><span class="tt" style="background:var(--mf-tt-' + t[2] + ')">' + ic(t[1]) + '</span><span class="nm">' + t[0] + '</span><span class="ct">' + t[3] + '</span></li>').join('') + '</ul>' +
      '<div class="sumgrid"><div class="card ms-details"><div class="bx-h"><h3>Details</h3></div><div class="ms-fields">' +
      f('CM Number', '<span class="ms-cm">' + mt.cm + '</span>') + f('Client', '<a class="link mono" href="#matter-summary">' + mt.cno + '</a> ' + esc(mt.client)) + f('Matter Number', '<span class="mono">' + mt.mno + '</span>') + f('Matter Name', esc(mt.name)) +
      f('Matter Type', mt.type) + f('Current State', mt.state) + f('DMS Path', '<span class="mono">\\\\fs01\\dms\\Matters\\' + mt.cno.slice(0, 4) + '\\' + mt.mno + '</span> <button class="btn btn--text">Copy</button>', 1) + f('DFS Path', '<span class="mono">https://dfs.example.com/matters/' + mt.cno + '/' + mt.mno + '</span> <button class="btn btn--text">Copy</button>', 1) +
      f('Status', '<span class="chip chip--ok">' + ic('check-circle') + 'Active</span>') + f('Primary PM', av(pr, true) + ' ' + pname(pr)) + f('Secondary PM', sc ? av(sc, true) + ' ' + pname(sc) : '<span class="muted">None</span>') + f('AI Allowed', '<span class="chip">' + ic('sparkles') + 'Yes</span>') + f('Created', mt.created) + f('Last Changed', mt.changed) +
      '</div></div><div class="side">' + panelTeam() + panelVendors() + '</div></div>');
  }
  /* read-only Show All */
  function listDialog() {
    const k = S.ld; const mt = M();
    if (k.kind === 'team') {
      const rows = teamOf(S.mid);
      const body = '<div class="frame" style="box-shadow:none;flex:none"><table><colgroup><col><col style="width:124px"><col style="width:200px"><col style="width:170px"></colgroup><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Title</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td><span class="two"><b>' + pname(r.p) + '</b></span><span class="two">' + esc(r.p.title) + (r.p.company ? ', ' + esc(r.p.company) : '') + '</span></td><td>' + typeChip(r.p) + '</td><td title="' + esc(r.p.email) + '">' + esc(r.p.email) + '</td><td>' + esc(r.t.title) + '</td></tr>').join('') + '</tbody></table></div>';
      return dialog('Team (' + rows.length + ')', esc(mt.name) + ' (' + mt.cm + ')', 'dlg--lg', body, '<span class="sp"></span><button class="btn btn--primary" data-a="close">Close</button>');
    }
    const vs = vendorsOf(S.mid); const bl = vs.filter((v) => v.cat === 'Blacklisted');
    const body = (bl.length ? '<div class="banner banner--bad" style="margin-bottom:12px" role="note">' + ic('exclamation-triangle') + '<span class="txt"><b>' + esc(bl[0].name) + ' is Blacklisted</b> (' + bl[0].updated + '). It was linked before it was blacklisted. Review it before more work goes to it.</span><button class="btn btn--text" data-a="goto|vendor-view">View Vendor</button></div>' : '') +
      '<div class="frame" style="box-shadow:none;flex:none"><table><colgroup><col><col style="width:124px"><col style="width:150px"><col style="width:130px"><col style="width:100px"></colgroup><thead><tr><th>Vendor</th><th>Category</th><th>Services</th><th>Contacts</th><th>Linked</th></tr></thead><tbody>' +
      vs.map((v) => { const cons = v.contacts.map((c) => D.person(c.pid)); const l = v.links.find((x) => x[0] === S.mid); return '<tr class="' + (v.cat === 'Blacklisted' ? 'row-warn' : '') + '"><td><span class="two"><b>' + esc(v.name) + '</b></span><span class="two" style="font-family:var(--mf-font-mono)">' + esc(v.site) + '</span></td><td>' + catChip(v.cat) + '</td><td>' + tagsShort(v.svc, 16) + '</td><td>' + (cons.length ? pname(cons[0]) + (cons.length > 1 ? ' +' + (cons.length - 1) : '') : '<span class="muted">None</span>') + '</td><td><span class="two">' + l[1] + '</span><span class="two">' + esc(l[2]) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    return dialog('Vendors (' + vs.length + ')', esc(mt.name) + ' (' + mt.cm + ')', 'dlg--lg', body, '<span class="sp"></span><button class="btn btn--primary" data-a="close">Close</button>');
  }

  /* Edit dialog: member list plus an always-present empty row with a combobox (apply on Save) */
  function initTE(kind) {
    S.te = { kind, rows: kind === 'team' ? teamOf(S.mid).map((r) => ({ pid: r.p.id, title: r.t.title, orig: true })) : vendorsOf(S.mid).map((v) => ({ vid: v.id, orig: true })), q: '', open: false, hot: 0, form: null, removed: 0 };
  }
  function teOptions() {
    const te = S.te; const q = te.q.trim().toLowerCase(); const out = [];
    if (te.kind === 'team') {
      const on = te.rows.map((r) => r.pid);
      const hit = D.PEOPLE.filter((p) => !q || (pname(p) + ' ' + p.email + ' ' + p.company + ' ' + p.title).toLowerCase().includes(q));
      hit.slice(0, 8).forEach((p) => out.push({ k: 'p', p, dis: on.includes(p.id) }));
      if (q && !hit.length) D.PEOPLE.filter((p) => lev(pname(p).toLowerCase(), q) <= 3).forEach((p) => out.push({ k: 'sim', p, dis: on.includes(p.id) }));
      if (q && !D.PEOPLE.some((p) => pname(p).toLowerCase() === q)) out.push({ k: 'create', q: te.q.trim() });
    } else {
      const on = te.rows.map((r) => r.vid); const linked = vendorsOf(S.mid).map((v) => v.id);
      const hit = D.VENDORS.filter((v) => !q || (v.name + ' ' + v.site + ' ' + v.svc.join(' ')).toLowerCase().includes(q));
      hit.slice(0, 8).forEach((v) => out.push({ k: 'v', v, dis: on.includes(v.id) }));
      if (!hit.length) out.push({ k: 'none', q: te.q.trim() });
    }
    return out;
  }
  function teDropdown() {
    const te = S.te; const opts = teOptions(); const pe = P(); let h = '';
    opts.forEach((o, i) => {
      const hot = i === te.hot ? ' hot' : '';
      if (o.k === 'p' || o.k === 'sim') {
        const p = o.p;
        h += (o.k === 'sim' && !h.includes('Similar') ? '<div class="grp">' + ic('exclamation-circle') + 'Did you mean this person?</div>' : '') + '<button class="po' + hot + '" ' + (o.dis ? 'disabled' : 'data-a="te-pick|' + p.id + '"') + '>' + av(p, true) + '<span class="txt"><span class="nm">' + pname(p) + '</span><span class="meta">' + esc(p.title) + ' &middot; ' + esc(p.company || p.email) + '</span></span>' + (o.dis ? '<span class="chip chip--off">On the List</span>' : typeChip(p).replace('chip ', 'chip bx-chip ')) + '</button>';
      } else if (o.k === 'create') {
        h += '<div class="add">' + (pe.pmanage ? '<button class="po' + hot + '" data-a="te-create"><span class="avatar avatar--sm" style="background:var(--mf-primary);color:#fff">' + ic('plus') + '</span><span class="txt"><span class="nm" style="color:var(--mf-link)">+ Create "' + esc(o.q) + '"</span><span class="meta">' + (opts.some((x) => x.k === 'sim') ? 'Check the people above first, to avoid a duplicate. ' : '') + 'Saved to People with Save Changes</span></span></button>'
          : '<div class="po" style="color:var(--mf-text-disabled)"><span class="avatar avatar--sm" style="background:var(--mf-surface-alt)">' + ic('lock') + '</span><span class="txt"><span class="nm">Create "' + esc(o.q) + '" (not available)</span><span class="meta">Needs People.Manage. Ask an administrator, or ask someone who has it.</span></span></div>') + '</div>';
      } else if (o.k === 'v') {
        const v = o.v; const bl = v.cat === 'Blacklisted'; const lk = vendorsOf(S.mid).some((x) => x.id === v.id);
        h += '<button class="po' + hot + '" style="' + (bl ? 'background:var(--mf-sem-risk-bg)' : '') + '" ' + (o.dis ? 'disabled' : 'data-a="te-pick|' + v.id + '"') + '><span class="avatar avatar--sm avatar--ext">' + ic('truck') + '</span><span class="txt"><span class="nm">' + esc(v.name) + '</span><span class="meta">' + esc(v.svc.slice(0, 3).join(', ')) + ' &middot; ' + esc(v.area.join(', ')) + (flagged(v, 'DNH') ? ' &middot; <span style="color:var(--mf-danger);font-weight:600">Do Not Hire contact</span>' : '') + '</span></span>' + (o.dis ? '<span class="chip chip--off">' + (lk ? 'Linked' : 'On the List') + '</span>' : catChip(v.cat).replace('chip ', 'chip bx-chip ')) + '</button>';
      } else if (o.k === 'none') {
        h += '<div class="po" style="color:var(--mf-text-muted)"><span class="txt"><span class="nm">No vendor matches "' + esc(o.q) + '"</span><span class="meta">' + (pe.manage ? 'New vendors are added on the Vendors page.' : 'Only vendors already in the list can be linked.') + '</span></span></div>';
      }
    });
    return '<div class="cbx cbx-up" role="listbox"><div class="list">' + (h || '<div class="po muted"><span class="txt">Type a name to search.</span></div>') + '</div></div>';
  }
  function teRow(r, i) {
    const te = S.te;
    if (te.kind === 'team') {
      const p = r.pid ? D.person(r.pid) : { id: 'new', first: r.np.first, last: r.np.last, type: r.np.type === 'Internal' ? 'int' : 'ext', user: false, title: '', company: r.np.company, email: r.np.email };
      return '<div class="erow ' + (r.orig ? '' : 'added') + '">' + av(p, true) + '<span class="pl-tx"><b>' + pname(p) + '</b><span class="pl-sub">' + esc(p.title ? p.title + ', ' : '') + esc(p.company || p.email) + '</span></span>' + (r.np ? '<span class="chip chip--risk bx-chip">New Person</span>' : typeChip(p).replace('chip ', 'chip bx-chip ')) +
        '<span class="inp tsel ' + (r.title ? '' : 'inv') + '" style="height:32px"><select data-te-title="' + i + '" aria-label="Title for ' + pname(p) + '"><option value="">Choose a title</option>' + D.TEAM_TITLES.map((t) => '<option' + (t === r.title ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></span><button class="btn btn--icon" data-a="te-rm|' + i + '" aria-label="Remove ' + pname(p) + '">' + ic('trash') + '</button></div>';
    }
    const v = D.vendor(r.vid); const bl = v.cat === 'Blacklisted'; const need = bl && !r.orig;
    return '<div class="erow ' + (r.orig ? '' : 'added') + (bl ? ' warnrow' : '') + '" style="' + (need ? 'height:auto;padding-top:8px;padding-bottom:8px;flex-wrap:wrap' : '') + '"><span class="avatar avatar--sm avatar--ext">' + ic('truck') + '</span><span class="pl-tx"><b>' + esc(v.name) + '</b><span class="pl-sub">' + esc(v.svc.slice(0, 3).join(', ')) + '</span></span>' + (r.orig ? '' : '<span class="chip chip--info bx-chip">To Add</span>') + catChip(v.cat).replace('chip ', 'chip bx-chip ') + '<button class="btn btn--icon" data-a="te-rm|' + i + '" aria-label="Unlink ' + esc(v.name) + '">' + ic('minus-circle') + '</button>' +
      (need ? '<div class="banner banner--bad" style="flex-basis:100%;align-items:flex-start;padding:6px 10px;margin-left:36px">' + ic('exclamation-triangle') + '<span class="txt"><b>Blacklisted.</b> ' + esc(v.note) + '<br><button class="chk" style="border:0;background:none;padding:0;margin-top:4px;font-weight:600" role="checkbox" aria-checked="' + !!r.ack + '" data-a="te-ack|' + i + '"><span class="box ' + (r.ack ? 'on' : '') + '">' + (r.ack ? ic('check') : '') + '</span> I have read this and still want to link it.</button></span></div>' : '') + '</div>';
  }
  function editDialog() {
    const te = S.te; const mt = M(); const team = te.kind === 'team';
    const added = te.rows.filter((r) => !r.orig).length; const removed = te.removed;
    const bad = team ? te.rows.some((r) => !r.title) : te.rows.some((r) => !r.orig && D.vendor(r.vid).cat === 'Blacklisted' && !r.ack);
    let empty;
    if (team && te.form) {
      const f = te.form;
      empty = '<div class="inline-new" style="margin:0"><h3>' + ic('user-plus') + 'New Person <span class="sm muted" style="font-weight:400">Saved to People with Save Changes. Only people in People can be on a team.</span></h3><div class="fgrid">' +
        '<div class="field"><label for="ni1">First Name <span class="req">(required)</span></label><div class="inp"><input id="ni1" value="' + esc(f.first) + '"></div></div><div class="field"><label for="ni2">Last Name <span class="req">(required)</span></label><div class="inp"><input id="ni2" value="' + esc(f.last) + '"></div></div>' +
        '<div class="field"><span class="lbl">Internal or External</span><span class="seg" role="group"><button aria-pressed="false">Internal</button><button aria-pressed="true">External</button></span></div><div class="field"><label for="ni3">Company Name</label><div class="inp"><input id="ni3" value="Whitaker Court Reporting"></div></div>' +
        '<div class="field"><label for="ni4">Email <span class="req">(required)</span></label><div class="inp"><input id="ni4" value="dana@whitakerreporting.example"></div></div><div class="field"><label for="ni5">Title on This Matter <span class="req">(required)</span></label><div class="inp"><select id="ni5"><option>Choose a title</option>' + D.TEAM_TITLES.map((t) => '<option>' + t + '</option>').join('') + '</select></div></div></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn--text" data-a="te-fcancel">Cancel New Person</button><button class="btn" data-a="te-fsave">Add to Team</button></div></div>';
    } else {
      empty = '<div class="erow erow-new" style="position:relative"><span class="avatar avatar--sm" style="background:var(--mf-surface-alt);color:var(--mf-text-muted)">' + ic(team ? 'user-plus' : 'link') + '</span><div class="inp" style="flex:1" data-a="te-open">' + ic('search') + '<input data-keep="te" value="' + esc(te.q) + '" placeholder="' + (team ? 'Search People by name, email or company' : 'Search vendors by name or service') + '" role="combobox" aria-expanded="' + te.open + '" aria-label="' + (team ? 'Add a person' : 'Add a vendor') + '" autocomplete="off">' + ic('chevron-down') + '</div>' +
        '<span class="inp tsel" style="height:32px;opacity:' + (team ? .6 : 0) + '">' + (team ? '<select disabled aria-label="Title"><option>Title</option></select>' : '') + '</span><span style="width:36px"></span>' + (te.open ? teDropdown() : '') + '</div>';
    }
    const colhead = team ? '<div class="ehead"><span>Person</span><span style="width:124px"></span><span style="width:176px">Title on This Matter</span><span style="width:36px"></span></div>' : '<div class="ehead"><span>Vendor</span></div>';
    const body = '<p class="sm muted" style="margin:0 0 8px">' + (team ? 'Type in the last row to find someone in People, pick them, then choose their title. A new empty row appears after each one. Nothing is saved until Save Changes.' : 'Type in the last row to find a vendor and pick it. Blacklisted vendors are flagged and need a tick. Nothing is saved until Save Changes.') + '</p>' + colhead + '<div class="erows" style="' + (te.form ? 'max-height:134px' : '') + '">' + te.rows.map(teRow).join('') + '</div>' + empty;
    const foot = '<button class="btn" data-a="close">Cancel</button><span class="mid">' + (added || removed ? (added ? added + ' added' : '') + (added && removed ? ', ' : '') + (removed ? removed + ' removed' : '') + (bad ? '. ' + (team ? 'Choose a title for every row.' : 'Tick the Blacklisted warning.') : '') : 'No changes yet.') + '</span><button class="btn btn--primary" data-a="save|Save Changes"' + (bad || (!added && !removed) ? ' disabled' : '') + '>Save Changes</button>';
    return dialog((team ? 'Edit Team' : 'Edit Vendors'), esc(mt.name) + ' (' + mt.cm + ')', 'dlg--lg', body, foot, true);
  }

  /* ---------- People page ---------- */
  function peoplePage() {
    const pe = P(); if (!pe.pview) return noAccess('People', 'People.View');
    const f = S.pf; const q = f.q.trim().toLowerCase();
    const rows = D.PEOPLE.filter((p) => (f.type === 'all' || p.type === f.type) && (!q || (pname(p) + p.email + p.company + p.title).toLowerCase().includes(q))).sort((a, b) => pname(a).localeCompare(pname(b)));
    const body = rows.map((p) => '<tr style="cursor:pointer"><td><span class="two"><button class="btn btn--name" data-a="editp|' + p.id + '">' + pname(p) + '</button></span><span class="two">' + esc(p.email) + '</span></td><td>' + typeChip(p) + '</td><td title="' + esc(p.title) + '">' + esc(p.title) + '</td><td>' + (p.company ? esc(p.company) : '<span class="muted">Law firm</span>') + '</td><td class="num">' + p.used.m + '</td><td class="num">' + p.used.v + '</td>' +
      (pe.pmanage ? '<td class="act"><button class="btn btn--icon" aria-label="Actions for ' + pname(p) + '">' + ic('ellipsis-h') + '</button></td>' : '') + '</tr>').join('');
    return '<main class="main">' + head('address-book', 'People', D.PEOPLE.length, pe.pmanage ? btn('New Person', 'dlg|personEdit', { cls: 'btn--primary', icon: 'plus' }) : '', 'The shared address book for matter teams and vendor contacts. Type a person once, pick them everywhere. System users appear here automatically.') +
      '<div class="toolbar"><label class="search">' + ic('search') + '<input data-keep="peq" value="' + esc(f.q) + '" placeholder="Search name, email or company" aria-label="Search people"></label>' +
      '<span class="seg" role="group" aria-label="Type">' + [['all', 'All'], ['int', 'Internal'], ['ext', 'External']].map((o) => '<button aria-pressed="' + (f.type === o[0]) + '" data-a="ptf|' + o[0] + '">' + o[1] + '</button>').join('') + '</span><span class="sp"></span><span class="sm muted">' + rows.length + ' of ' + D.PEOPLE.length + ' people</span></div>' +
      '<div class="frame"><div class="scroll"><table><colgroup><col><col style="width:140px"><col style="width:180px"><col style="width:200px"><col style="width:var(--mf-col-count-w)"><col style="width:var(--mf-col-count-w)">' + (pe.pmanage ? '<col style="width:var(--mf-col-actions-w)">' : '') + '</colgroup>' +
      '<thead><tr><th>Name ' + ic('arrow-up') + '</th><th>Type</th><th>Title or Role</th><th>Company</th><th class="num">Matters</th><th class="num">Vendors</th>' + (pe.pmanage ? '<th class="act"><span class="sr">Actions</span></th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div><div class="pager"><span>1 to ' + rows.length + ' of ' + rows.length + '</span><span class="sp"></span><span>Rows per page: 25</span></div></div></main>';
  }

  /* ---------- Permission matrix ---------- */
  function permPage() {
    const yes = ic('check-circle').replace('class="pi', 'class="yes pi'), no = ic('minus').replace('class="pi', 'class="no pi');
    let rows = ''; let g = '';
    D.PERMS.forEach((p) => {
      if (p.group !== g) { g = p.group; rows += '<tr class="grp"><td colspan="' + (D.ROLES.length + 1) + '">' + g + '</td></tr>'; }
      rows += '<tr><td><code>' + p.code + '</code><div class="xs muted" style="white-space:normal;line-height:1.3">' + esc(p.short) + '</div></td>' + p.roles.map((r) => '<td>' + (r ? yes : no) + '</td>').join('') + '</tr>';
    });
    const editor = ['Vendors', 'People'].map((gr) => '<div class="gh">' + gr + '</div>' + D.PERMS.filter((x) => x.group === gr).map((x) => '<div class="permrow"><span class="chk"><span class="box ' + (x.roles[2] ? 'on' : '') + '">' + (x.roles[2] ? ic('check') : '') + '</span></span><div><code>' + x.code + '</code><div class="d">' + esc(x.desc) + '</div></div></div>').join('')).join('');
    return '<main class="main">' + head('users', 'Users', null, '') + '<div class="tabs" role="tablist"><span class="tab">' + ic('users') + 'Users</span><span class="tab" role="tab" aria-selected="true">' + ic('key') + 'Roles</span><span class="tab">' + ic('sitemap') + 'Pods</span></div>' +
      '<div class="cols2"><div class="card"><div class="ch"><h3>New Permissions by Role</h3><span class="sp"></span><span class="legend"><span>' + yes + ' Granted</span><span>' + no + ' Not granted</span></span></div><div class="cb" style="padding:0"><table class="matrix"><colgroup><col style="width:27%">' + D.ROLES.map(() => '<col>').join('') + '</colgroup><thead><tr><th>Permission</th>' + D.ROLES.map((r) => '<th class="rh">' + r + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="ch" style="border-top:1px solid var(--mf-border-soft);border-bottom:0;font-size:13px;color:var(--mf-text-muted)">Defaults are a proposal for the built-in roles; three more roles exist and start with none. An administrator can change any of it.</div></div>' +
      '<div class="card"><div class="ch"><h3>Project Manager</h3><span class="chip chip--off">Role editor</span></div><div class="cb">' + editor + '<div class="banner" style="margin-top:12px">' + ic('info-circle') + '<span class="txt">Ticking Vendor.Manage or Vendor.Link also ticks Vendor.View, as the Dashboard tabs do.</span></div></div></div></div></main>';
  }
  function withoutPage() {
    const rows = [
      ['Vendor.View missing', 'Vendors menu item hidden. Opening the address shows Access Denied.', 'Vendors panel hidden; the Team panel fills the column.', 'Not reachable.'],
      ['Vendor.View only (no Manage)', 'Page and detail panel are read only: no New Vendor, row menu, Edit, Delete, Add Contact or Edit Note. Flags and notes stay readable.', 'Vendors panel readable.', 'Not reachable.'],
      ['Vendor.Link missing', 'Unchanged.', 'Edit on the Vendors panel shown disabled with the reason in the panel footer. No Unlink.', 'Add Vendors picker not reachable.'],
      ['People.Manage missing', 'People page is read only: no New Person, no row menu, no Edit.', 'Team panel unchanged (Edit needs Matter.Edit as today).', '"Add New Person" shown disabled with the reason. Existing people can still be picked.'],
      ['People.View missing', 'People menu item hidden. Opening the address shows Access Denied.', 'Team panel unchanged.', 'Pickers still list everyone, for anyone who may edit a team or a vendor contact.'],
    ];
    return '<main class="main">' + head('lock', 'What a Person Without a Permission Sees', null, '', 'Rule of thumb: a whole page is hidden when the person has no business there; an action that is the point of a panel they can read is shown disabled, with the reason in plain text next to it.') +
      '<div class="frame"><div class="scroll"><table><colgroup><col style="width:200px"><col style="width:34%"><col style="width:24%"><col></colgroup><thead><tr><th>Missing</th><th>Menu and page</th><th>On the matter</th><th>Pickers and dialogs</th></tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c, i) => '<td style="height:auto;padding:12px;vertical-align:top;white-space:normal;' + (i === 0 ? 'font-weight:600' : '') + '">' + (i === 0 ? '<code>' + c.split(' ')[0] + '</code><div class="sm" style="font-weight:400">' + c.split(' ').slice(1).join(' ') + '</div>' : c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>' +
      '<div class="controls"><span class="sm muted">Open the "No ..." screens in the guide to see each state in place.</span></div></main>';
  }

  /* ---------- guide (mockup chrome) ---------- */
  function guide() {
    const links = SCREENS.map((g) => '<h3>' + g[0] + '</h3>' + g[1].map((s) => '<a href="#' + s[0] + '" ' + (S.screen === s[0] ? 'aria-current="true"' : '') + '>' + s[1] + '</a>').join('')).join('');
    return '<button class="mk-pill" data-a="guide" aria-expanded="' + S.guide + '">' + ic('list') + 'Mockup Guide</button>' + (S.guide ? '<div class="mk-panel" role="dialog" aria-label="Mockup guide"><h2>Vendor Management mockup</h2><p>Click through, or jump to a screen. Nothing saves. Layout is for 1366x768 and 1920x1080.</p>' +
      '<h3>Who is looking</h3><select data-a="persona" aria-label="Who is looking">' + Object.keys(D.PERSONAS).map((k) => '<option value="' + k + '"' + (S.persona === k ? ' selected' : '') + '>' + D.PERSONAS[k].label + '</option>').join('') + '</select>' + links + '</div>' : '');
  }

  /* ---------- render + events ---------- */
  function render() {
    const pe = P(); let main;
    if (S.page === 'vendors') main = vendorsPage(); else if (S.page === 'people') main = peoplePage(); else if (S.page === 'matterSummary') main = summaryPage(); else if (S.page === 'without') main = withoutPage(); else main = permPage();
    $root.innerHTML = '<div class="app">' + nav() + top() + main + '</div>' + overlays() + guide();
    document.querySelectorAll('.mk-only').forEach((e) => { if (document.body.classList.contains('nochrome')) e.style.display = 'none'; });
    if (S.keep) { const el = document.querySelector('[data-keep="' + S.keep + '"]'); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* ignore */ } } }
    const er = document.querySelector('.erows'); if (er && S.te && S.te.rows.some((r) => !r.orig)) er.scrollTop = er.scrollHeight;
    const fr = document.querySelector('.prow[data-fr]'); if (fr) { const pl = fr.parentElement; pl.scrollTop = fr.offsetTop - 60; }
    document.title = 'Vendor Management Mockup';
  }
  const toggle = (arr, x) => (arr.includes(x) ? arr.filter((y) => y !== x) : arr.concat([x]));
  function setDd(id, val) {
    const tgt = id.startsWith('pk-') ? S.pk : S.f; const key = id.replace('pk-', '');
    if (key === 'cat') { tgt.cat = val; S.menu = null; }
    else { tgt[key] = val === '__clear' ? [] : toggle(tgt[key], val); }
  }
  const acts = {
    noop: () => {}, close: () => { if (S.dialog) { S.dialog = null; S.menu = null; S.pp = { open: false, q: '' }; S.tm = { newOpen: false, picked: null }; S.te = null; } else { S.drawer = null; S.vedit = false; S.vnote = null; S.ac = false; S.vdel = false; } S.keep = null; },
    guide: () => { S.guide = !S.guide; },
    drawer: (id) => { if (P().view) { S.drawer = id; S.dtab = 'overview'; S.menu = null; } },
    dtab: (t) => { if (!S.vedit) { S.dtab = t; S.vnote = null; S.ac = false; } },
    ld: (kind, e) => { S.menu = null; if (e === '1') { initTE(kind); S.dialog = 'editDlg'; } else { S.ld = { kind, edit: false }; S.dialog = 'listDlg'; } },
    coll: (k) => { S.coll[k] = !S.coll[k]; },
    'te-open': () => { S.te.open = true; S.keep = 'te'; },
    'te-pick': (id) => { const t = S.te; t.rows.push(t.kind === 'team' ? { pid: id, title: '' } : { vid: id, ack: false }); t.q = ''; t.open = false; t.hot = 0; S.keep = 'te'; },
    'te-rm': (i) => { const t = S.te; if (t.rows[i].orig) t.removed++; t.rows.splice(+i, 1); },
    'te-ack': (i) => { S.te.rows[i].ack = !S.te.rows[i].ack; },
    'te-create': () => { const q = S.te.q.trim().split(/\s+/); S.te.form = { first: q[0] || '', last: q.slice(1).join(' ') }; S.te.open = false; },
    'te-fcancel': () => { S.te.form = null; },
    'te-fsave': () => { S.te.rows.push({ np: { first: S.te.form.first, last: S.te.form.last, type: 'External', company: 'Whitaker Court Reporting', email: 'dana@whitakerreporting.example' }, title: 'Vendor Contact' }); S.te.form = null; S.te.q = ''; },
    dlg: (n) => { S.dialog = n; S.menu = null; S.pp = { open: false, q: '' }; S.tm = { newOpen: false, picked: null }; if (n === 'newVendor') S.cvSel = { cat: 'Preferred', svc: [], area: [] }; if (n === 'personEdit') S.pe = 'new'; if (n === 'deleteVendor') S.dv = S.drawer; },
    menu: (id) => { S.menu = S.menu === id ? null : id; },
    ddset: (id, val) => setDd(id, val),
    clearf: () => { S.f = { q: '', cat: 'all', svc: [], area: [] }; S.menu = null; },
    pkclear: () => { S.pk.q = ''; S.pk.cat = 'all'; S.pk.svc = []; S.pk.area = []; S.menu = null; },
    edit: (id) => { S.drawer = id; S.dtab = 'overview'; S.vedit = true; S.menu = null; S.cvSel = { cat: D.vendor(id).cat, svc: D.vendor(id).svc.slice(), area: D.vendor(id).area.slice() }; },
    del: (id) => { S.dv = id; S.dialog = 'deleteVendor'; S.menu = null; },
    cv: (g, x) => { if (g === 'cat') S.cvSel.cat = x; else S.cvSel[g] = toggle(S.cvSel[g], x); },
    vedit: () => { S.vedit = !S.vedit; if (S.vedit) { const v = D.vendor(S.drawer); S.dtab = 'overview'; S.cvSel = { cat: v.cat, svc: v.svc.slice(), area: v.area.slice() }; } },
    vdel: () => { S.vdel = !S.vdel; },
    vnote: (p) => { S.vnote = p || null; S.noteFlag = null; },
    ac: () => { S.ac = true; S.pp = { open: true, q: '' }; S.tm = { newOpen: false, picked: null }; S.keep = 'pp'; },
    acx: () => { S.ac = false; S.pp = { open: false, q: '' }; S.tm = { newOpen: false, picked: null }; },
    acsave: () => { S.ac = false; S.toast = 'Contact added (demo only)'; setTimeout(() => { S.toast = null; render(); }, 2200); },
    flag: (f) => { S.noteFlag = f; },
    pksel: (id) => { S.pk.sel = toggle(S.pk.sel, id); if (!S.pk.sel.some((i) => D.vendor(i).cat === 'Blacklisted')) S.pk.ack = false; },
    ack: () => { S.pk.ack = !S.pk.ack; },
    ppopen: () => { S.pp.open = true; S.keep = 'pp'; },
    pick: (id) => { S.tm.picked = id; S.pp = { open: false, q: '' }; S.keep = null; },
    unpick: () => { S.tm.picked = null; S.pp.open = true; },
    newp: () => { S.tm.newOpen = true; S.pp.open = false; S.keep = null; },
    cancelnew: () => { S.tm.newOpen = false; },
    savenew: () => { S.tm.newOpen = false; S.tm.picked = 'p9'; S.toast = 'Dana Whitaker saved to People'; setTimeout(() => { S.toast = null; render(); }, 2500); },
    ptype: () => {},
    ptf: (t) => { S.pf.type = t; },
    editp: (id) => { S.pe = id; S.dialog = 'personEdit'; },
    goto: (id) => { location.hash = id; },
    save: (label) => { if (label === 'Save Note') { S.vnote = null; } else if (label === 'Save Changes' && S.vedit) { S.vedit = false; } else if (label === 'Delete Vendor' && S.drawer) { S.drawer = null; S.vdel = false; } else { S.dialog = null; } S.menu = null; S.toast = label + ': saved (demo only)'; setTimeout(() => { S.toast = null; render(); }, 2200); },
  };
  $root.addEventListener('click', (e) => {
    const stop = e.target.closest('[data-stop]'); const el = e.target.closest('[data-a]');
    if (e.target.closest('[data-dead]')) { e.preventDefault(); return; }
    if (!el) { if (S.menu) { S.menu = null; render(); } return; }
    if (stop && el.classList.contains('scrim')) return;
    if (el.classList.contains('scrim') && e.target !== el) return;
    const [a, ...args] = el.getAttribute('data-a').split('|');
    if (el.tagName === 'SELECT') return;
    if (acts[a]) { e.preventDefault(); e.stopPropagation(); acts[a](...args); render(); }
  });
  $root.addEventListener('input', (e) => {
    const k = e.target.getAttribute && e.target.getAttribute('data-keep'); if (!k) return;
    if (k === 'vq') S.f.q = e.target.value; else if (k === 'pq') S.pk.q = e.target.value; else if (k === 'peq') S.pf.q = e.target.value; else if (k === 'pp') { S.pp.q = e.target.value; S.pp.open = true; } else if (k === 'te') { S.te.q = e.target.value; S.te.open = true; S.te.hot = 0; }
    S.keep = k; render();
  });
  $root.addEventListener('change', (e) => { const ti = e.target.getAttribute && e.target.getAttribute('data-te-title'); if (ti != null) { S.te.rows[ti].title = e.target.value; render(); return; } if (e.target.getAttribute('data-a') === 'persona') { S.persona = e.target.value; render(); } });
  $root.addEventListener('keydown', (e) => {
    if (!(e.target.getAttribute && e.target.getAttribute('data-keep') === 'te')) return;
    const t = S.te; const n = teOptions().length;
    if (e.key === 'ArrowDown') { t.open = true; t.hot = Math.min(n - 1, t.hot + 1); e.preventDefault(); render(); }
    else if (e.key === 'ArrowUp') { t.hot = Math.max(0, t.hot - 1); e.preventDefault(); render(); }
    else if (e.key === 'Enter' && t.open) { const o = teOptions()[t.hot]; if (o && !o.dis) { e.preventDefault(); if (o.k === 'create') acts['te-create'](); else if (o.k === 'p' || o.k === 'sim') acts['te-pick'](o.p.id); else if (o.k === 'v') acts['te-pick'](o.v.id); render(); } }
    else if (e.key === 'Escape' && t.open) { t.open = false; e.stopPropagation(); e.preventDefault(); render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && (S.dialog || S.drawer || S.menu)) { if (S.menu) S.menu = null; else acts.close(); render(); } });
  window.addEventListener('hashchange', () => applyScreen(location.hash.slice(1)));
  applyScreen(location.hash.slice(1) || 'vendors');
})();
