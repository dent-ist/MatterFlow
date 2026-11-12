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
      ['vendor-drawer', 'Vendor detail drawer: Overview', { page: 'vendors', drawer: 'v4', dtab: 'overview' }],
      ['vendor-contacts', 'Vendor detail drawer: Contacts and notes', { page: 'vendors', drawer: 'v1', dtab: 'contacts' }],
      ['vendor-matters', 'Vendor detail drawer: Matters', { page: 'vendors', drawer: 'v1', dtab: 'matters' }],
      ['vendor-edit', 'Edit Vendor dialog', { page: 'vendors', drawer: 'v1', dtab: 'overview', dialog: 'editVendor', dv: 'v1' }],
      ['vendor-new', 'New Vendor dialog', { page: 'vendors', dialog: 'newVendor' }],
      ['vendor-note', 'Contact Note dialog', { page: 'vendors', drawer: 'v4', dtab: 'contacts', dialog: 'contactNote', dctx: ['v4', 'p13'] }],
      ['vendor-add-contact', 'Add Contact (pick a person)', { page: 'vendors', drawer: 'v1', dtab: 'contacts', dialog: 'addContact', pp: { open: true, q: '' } }],
      ['vendor-delete', 'Delete Vendor (allowed)', { page: 'vendors', dialog: 'deleteVendor', dv: 'v6' }],
      ['vendor-delete-blocked', 'Delete Vendor (blocked, in use)', { page: 'vendors', dialog: 'deleteVendor', dv: 'v1' }],
    ]],
    ['Matter', [
      ['matter-summary', 'Matter > Summary: Team and Vendors boxes', { page: 'matterSummary' }],
      ['matter-summary-empty', 'Matter > Summary: both boxes empty', { page: 'matterSummary', teamEmpty: true }],
      ['matter-team-all', 'Team: Show All (read only)', { page: 'matterSummary', dialog: 'listDlg', ld: { kind: 'team', edit: false } }],
      ['matter-team-edit', 'Team: Edit', { page: 'matterSummary', dialog: 'listDlg', ld: { kind: 'team', edit: true } }],
      ['matter-team-add', 'Add Team Member: pick a person', { page: 'matterSummary', dialog: 'teamAdd', pp: { open: true, q: '' } }],
      ['matter-team-new', 'Add Team Member: add new person inline', { page: 'matterSummary', dialog: 'teamAdd', tm: { newOpen: true } }],
      ['matter-vendors-all', 'Vendors: Show All (read only)', { page: 'matterSummary', dialog: 'listDlg', ld: { kind: 'vendors', edit: false } }],
      ['matter-vendors-edit', 'Vendors: Edit', { page: 'matterSummary', dialog: 'listDlg', ld: { kind: 'vendors', edit: true } }],
      ['matter-picker', 'Add Vendors picker', { page: 'matterSummary', dialog: 'picker', pk: { sel: ['v9', 'v5'] } }],
      ['matter-picker-warn', 'Add Vendors picker, blacklisted selected', { page: 'matterSummary', dialog: 'picker', pk: { sel: ['v9', 'v4'], cat: 'all' } }],
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
      ['noperm-matter', 'No Vendor.View: Vendors box hidden', { page: 'matterSummary', persona: 'none' }],
      ['noperm-readonly', 'Vendor.View only: read-only drawer', { page: 'vendors', persona: 'ro', drawer: 'v1', dtab: 'contacts' }],
      ['noperm-link', 'No Vendor.Link: Edit disabled, reason shown', { page: 'matterSummary', persona: 'ro' }],
      ['noperm-people', 'No People.Manage: Add New Person disabled', { page: 'matterSummary', persona: 'ro', dialog: 'teamAdd', pp: { open: true, q: '' } }],
    ]],
  ];
  const FLAT = SCREENS.flatMap((g) => g[1]);

  const blank = () => ({ page: 'vendors', drawer: null, dtab: 'overview', dialog: null, dv: null, dctx: null, menu: null, mvEmpty: false,
    f: { q: '', cat: 'all', svc: [], area: [] },
    pk: { q: '', cat: 'all', svc: [], area: [], sel: [], ack: false },
    teamEmpty: false, ld: { kind: 'team', edit: false }, pp: { open: false, q: '' }, tm: { newOpen: false, picked: null, ptype: 'External' }, pe: 'new', pf: { q: '', type: 'all' }, noteFlag: null, noteSeg: null, toast: null,
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

  /* ---------- Vendor drawer ---------- */
  function drawer() {
    const v = D.vendor(S.drawer); const pe = P(); const t = S.dtab;
    const cons = contactsOf(v);
    const tabs = [['overview', 'Overview', 'info-circle', ''], ['contacts', 'Contacts', 'users', ' (' + v.contacts.length + ')'], ['matters', 'Matters', 'folder', ' (' + v.links.length + ')']];
    let body = '';
    if (t === 'overview') {
      body = (v.cat === 'Blacklisted' ? '<div class="banner banner--bad" role="note">' + ic('ban') + '<span class="txt"><b>Blacklisted.</b> This vendor stays in lists and can still be linked to a matter, but every place it appears carries this warning.</span></div>' : '') +
        '<dl class="facts"><dt>Category</dt><dd>' + catChip(v.cat) + '</dd><dt>Website</dt><dd><a class="link mono" style="font-family:var(--mf-font-mono)" href="#" data-a="noop">https://' + esc(v.site) + '</a> ' + ic('external-link') + '</dd>' +
        '<dt>Services</dt><dd>' + tagsAll(v.svc) + '</dd><dt>Areas</dt><dd>' + tagsAll(v.area, 'tag--teal') + '</dd>' +
        '<dt>Tech AI</dt><dd>' + (v.ai.length ? v.ai.map((a) => '<div class="ai">' + ic('microchip-ai') + esc(a) + '</div>').join('') : '<span class="muted">None reported</span>') + '</dd>' +
        '<dt>Note</dt><dd>' + esc(v.note) + '</dd><dt>Last Updated</dt><dd>' + v.updated + '</dd></dl>';
    } else if (t === 'contacts') {
      body = '<div class="sect"><h3>Contacts</h3><span class="cnt">' + v.contacts.length + '</span><span class="sp"></span>' + (pe.manage ? btn('Add Contact', 'dlg|addContact', { icon: 'user-plus' }) : '') + '</div>' +
        (cons.length ? '<div>' + cons.map((c) => {
          const p = c.p;
          return '<div class="contact"><div class="who">' + av(p) + '<div style="min-width:0"><div class="nm">' + pname(p) + ' <span class="muted" style="font-weight:400">' + esc(p.title) + '</span></div><div class="sm muted">' + esc(p.email) + '</div></div></div>' +
            '<div style="display:flex;align-items:center;gap:8px">' + (c.flag ? flagChip(c.flag) : '<span class="sm muted">No note</span>') + (pe.manage ? '<button class="btn btn--text" data-a="note|' + v.id + '|' + p.id + '">' + (c.flag ? 'Edit Note' : 'Add Note') + '</button>' : '') + '</div>' +
            (c.flag ? '<div class="note ' + (c.flag === 'DNH' ? 'bad' : 'ok') + '"><div class="hd">' + ic('flag') + 'Reported ' + c.date + ' by ' + esc(c.by) + '</div>' + esc(c.note) + '</div>' : '') + '</div>';
        }).join('') + '</div>' : '<div class="state">' + ic('users') + '<p>No contacts yet.</p><small>Add the people at this vendor you deal with. Pick them from People, or add a new person on the way.</small></div>');
    } else {
      body = '<div class="sect"><h3>Matters</h3><span class="cnt">' + v.links.length + '</span></div>' +
        (v.links.length ? '<div class="frame" style="flex:none;box-shadow:none"><table><colgroup><col style="width:110px"><col><col style="width:130px"><col style="width:96px"><col style="width:120px"></colgroup><thead><tr><th>CM Number</th><th>Matter</th><th>Client</th><th>Linked</th><th>Linked By</th></tr></thead><tbody>' +
          v.links.map((l) => { const m = D.matter(l[0]); return '<tr><td><a class="link mono" style="font-family:var(--mf-font-mono)" href="#matter-summary">' + m.cm + '</a></td><td title="' + esc(m.name) + '">' + esc(m.name) + '</td><td>' + esc(m.client) + '</td><td>' + l[1] + '</td><td>' + esc(l[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          '<p class="sm muted" style="margin:0">Vendors are linked from the matter: open a matter, Summary, then Edit on the Vendors box.</p>'
          : '<div class="state">' + ic('folder') + '<p>Not linked to any matter.</p><small>Link it from a matter\'s Summary tab. A vendor with no matters can be deleted.</small></div>');
    }
    return '<div class="scrim scrim--drawer" data-a="close"><aside class="drawer" role="dialog" aria-label="Vendor ' + esc(v.name) + '" data-stop="1"><header><h2 style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(v.name) + '</h2>' + catChip(v.cat) + '<span class="sp"></span>' +
      (pe.manage ? iconBtn('pencil', 'edit|' + v.id, 'Edit vendor') + iconBtn('trash', 'del|' + v.id, 'Delete vendor') : '') + iconBtn('times', 'close', 'Close') + '</header>' +
      '<div class="tabs" role="tablist">' + tabs.map((x) => '<button class="tab" role="tab" aria-selected="' + (t === x[0]) + '" data-a="dtab|' + x[0] + '">' + ic(x[2]) + x[1] + x[3] + '</button>').join('') + '</div>' +
      '<div class="bd">' + body + '</div></aside></div>';
  }

  /* ---------- dialogs ---------- */
  function dialog(title, sub, size, body, footer, vis) {
    return '<div class="scrim" data-a="close"><div class="dlg ' + (size || '') + '" role="dialog" aria-modal="true" aria-label="' + title + '" data-stop="1"><header><div style="flex:1;min-width:0"><h2>' + title + '</h2>' + (sub ? '<span class="subt">' + sub + '</span>' : '') + '</div>' + iconBtn('times', 'close', 'Close') + '</header><div class="bd" ' + (vis ? 'style="overflow:visible"' : '') + '>' + body + '</div><footer>' + footer + '</footer></div></div>';
  }
  const cancelSave = (label, extra) => '<button class="btn" data-a="close">Cancel</button>' + (extra || '<span class="sp"></span>') + '<button class="btn btn--primary" data-a="save|' + label + '">' + label + '</button>';

  function fchips(group, all, sel) {
    return '<div class="tags" role="group">' + all.map((x) => '<button class="fchip" aria-pressed="' + sel.includes(x) + '" data-a="cv|' + group + '|' + x + '">' + (sel.includes(x) ? ic('check') : '') + esc(x) + '</button>').join('') + '</div>';
  }
  function vendorDialog(isNew) {
    const v = isNew ? { name: '', site: '', ai: [], note: '' } : D.vendor(S.dv);
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
    return dialog(isNew ? 'New Vendor' : 'Edit Vendor', isNew ? '' : esc(v.name), 'dlg--lg', body, cancelSave(isNew ? 'Create Vendor' : 'Save Changes'));
  }
  function noteDialog() {
    const [vid, pid] = S.dctx || ['v4', 'p13']; const v = D.vendor(vid); const p = D.person(pid);
    const c = v.contacts.find((x) => x.pid === pid) || {}; const fl = S.noteFlag == null ? c.flag || '' : S.noteFlag;
    const opts = [['', 'No Note'], ['REC', 'Recommended'], ['DNH', 'Do Not Hire']];
    const body = '<div class="fgrid"><div class="field full"><span class="lbl">Note Flag</span><span class="seg" role="group" aria-label="Note flag">' + opts.map((o) => '<button aria-pressed="' + (fl === o[0]) + '" data-a="flag|' + o[0] + '">' + (o[0] === 'DNH' ? ic('ban') : o[0] === 'REC' ? ic('thumbs-up') : '') + o[1] + '</button>').join('') + '</span>' +
      '<div class="help">One flag per contact. The flag shows on the vendor, in the Add Vendor picker and on matters, so everyone sees it before hiring.</div></div>' +
      '<div class="field"><label for="nd">Reported Date <span class="req">(required)</span></label><div class="inp"><input id="nd" value="' + (c.date || D.TODAY) + '">' + ic('calendar') + '</div></div>' +
      '<div class="field"><label for="nb">Reported By <span class="req">(required)</span></label><div class="inp">' + ic('search') + '<input id="nb" value="' + esc(c.by || P().name) + '"></div><div class="help">Defaults to you. Pick someone else if you are recording their report.</div></div>' +
      '<div class="field full"><label for="nn">Note <span class="req">(required)</span></label><textarea id="nn" class="inp" rows="4">' + esc(c.note || '') + '</textarea><div class="help">Say what happened, on which matter if it helps. Everyone who can view vendors can read this.</div></div></div>';
    return dialog('Contact Note', esc(pname(p)) + ', ' + esc(v.name), '', body, cancelSave('Save Note'));
  }

  /* person picker (used by Team box and vendor Add Contact) */
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
  function teamDialog() {
    const teamIds = D.TEAM.map((t) => t.pid); const t = S.tm; const p = t.picked ? D.person(t.picked) : null;
    let personField;
    if (t.newOpen) personField = '<div class="full">' + newPersonInline('selected for this matter') + '</div>';
    else if (p) personField = '<div class="field full"><span class="lbl">Person <span class="req">(required)</span></span>' + pickedBox(p) + '</div>';
    else personField = '<div class="field full"><label for="pp">Person <span class="req">(required)</span></label><div class="inp" data-a="ppopen">' + ic('search') + '<input id="pp" data-keep="pp" value="' + esc(S.pp.q) + '" placeholder="Search by name, email or company" role="combobox" aria-expanded="' + S.pp.open + '" autocomplete="off">' + ic('chevron-down') + '</div>' +
      (S.pp.open ? pickerHtml(teamIds, 'On the Team') : '<div class="help">Everyone in People: system users, other firm staff and outside contacts.</div>') + '</div>';
    const body = '<div class="fgrid">' + personField +
      '<div class="field full" ' + (S.pp.open && !p && !t.newOpen ? 'style="visibility:hidden;height:0"' : '') + '><label for="tt">Title on This Matter <span class="req">(required)</span></label><div class="inp"><select id="tt"><option>' + (p ? 'Client Contact' : 'Select a title') + '</option>' + D.TEAM_TITLES.map((x) => '<option>' + x + '</option>').join('') + '</select></div><div class="help">From the Team Titles list. The person\'s own Title or Role stays on their People record.</div></div></div>';
    const foot = '<button class="btn" data-a="close">Cancel</button><span class="mid">' + (p ? 'The same person cannot be on one matter twice.' : '') + '</span><button class="btn btn--primary" data-a="save|Add Member">Add Member</button>';
    return dialog('Add Team Member', 'Acme Holdings v. Beta Corp (10482-0017)', '', (S.pp.open && !p && !t.newOpen ? '<div style="min-height:410px">' + body + '</div>' : body), foot, true);
  }
  function addContactDialog() {
    const v = D.vendor(S.drawer || 'v1'); const t = S.tm; const p = t.picked ? D.person(t.picked) : null;
    let f;
    if (t.newOpen) f = newPersonInline('added as a contact');
    else if (p) f = '<div class="field"><span class="lbl">Person <span class="req">(required)</span></span>' + pickedBox(p) + '</div>';
    else f = '<div class="field"><label for="pp">Person <span class="req">(required)</span></label><div class="inp" data-a="ppopen">' + ic('search') + '<input id="pp" data-keep="pp" value="' + esc(S.pp.q) + '" placeholder="Search by name, email or company" role="combobox" aria-expanded="' + S.pp.open + '" autocomplete="off">' + ic('chevron-down') + '</div>' + (S.pp.open ? pickerHtml(v.contacts.map((c) => c.pid), 'Already a Contact') : '') + '</div>';
    return dialog('Add Contact', esc(v.name), '', (S.pp.open && !p && !t.newOpen ? '<div style="min-height:410px">' : '<div>') + f + '<div class="help" style="margin-top:12px">Contacts at a vendor are normally External people. A note flag can be added after saving.</div></div>', cancelSave('Add Contact'), true);
  }
  function deleteDialog() {
    const v = D.vendor(S.dv); const n = v.links.length;
    if (n) return dialog('Delete Vendor', '', 'dlg--sm', '<p><b>' + esc(v.name) + '</b> is linked to ' + n + ' matter' + (n > 1 ? 's' : '') + ' and cannot be deleted. Unlink it from each matter first. If the firm should stop using it, set its category to Blacklisted instead.</p>', '<span class="sp"></span><button class="btn btn--primary" data-a="close">Close</button>');
    return dialog('Delete Vendor', '', 'dlg--sm', '<p>Delete <b>' + esc(v.name) + '</b> and its ' + v.contacts.length + ' contact' + (v.contacts.length === 1 ? '' : 's') + '? The people stay in People. This cannot be undone.</p>', '<button class="btn" data-a="close">Cancel</button><button class="btn btn--solid-danger" data-a="save|Delete Vendor">Delete Vendor</button>');
  }

  /* vendor picker (matter) */
  function pickerDialog() {
    const k = S.pk; const linked = m1Vendors().map((v) => v.id);
    const rows = D.VENDORS.filter((v) => vendorMatch(v, k)).sort((a, b) => a.name.localeCompare(b.name));
    const sel = k.sel; const selBl = sel.map((i) => D.vendor(i)).filter((v) => v.cat === 'Blacklisted');
    const list = rows.map((v) => {
      const isL = linked.includes(v.id); const on = sel.includes(v.id); const bl = v.cat === 'Blacklisted'; const dnh = flagged(v, 'DNH'); const rec = flagged(v, 'REC');
      return '<div class="prow ' + (bl ? 'warn ' : '') + (isL ? 'is-linked' : '') + '"' + (on && bl ? ' data-fr="1"' : '') + '>' +
        (isL ? '<span class="chk"><span class="box" style="background:var(--mf-surface-alt);border-color:var(--mf-border-mid)"></span></span>' : '<button class="chk" style="border:0;background:none;padding:0" role="checkbox" aria-checked="' + on + '" aria-label="Select ' + esc(v.name) + '" data-a="pksel|' + v.id + '"><span class="box ' + (on ? 'on' : '') + '">' + (on ? ic('check') : '') + '</span></button>') +
        '<div style="min-width:0"><span class="nm">' + esc(v.name) + '</span><span class="sub2"><span class="mono" style="font-family:var(--mf-font-mono)">' + esc(v.site) + '</span>' + (dnh ? '<span style="color:var(--mf-danger);font-weight:600">' + ic('flag') + ' ' + dnh + ' contact flagged Do Not Hire</span>' : '') + (rec && !bl ? '<span style="color:var(--mf-sem-healthy-fg)">' + ic('thumbs-up') + ' ' + rec + ' recommended contact</span>' : '') + '</span></div>' +
        '<div><div class="tags" style="gap:4px">' + v.svc.slice(0, 2).map((x) => '<span class="tag">' + esc(x) + '</span>').join('') + (v.svc.length > 2 ? '<span class="cnt">+' + (v.svc.length - 2) + '</span>' : '') + '</div><div class="sm muted" style="margin-top:2px">' + v.area.join(', ') + '</div></div>' +
        '<div style="text-align:right">' + (isL ? '<span class="chip chip--off">' + ic('link') + 'Linked</span>' : catChip(v.cat)) + '</div></div>';
    }).join('');
    const warn = selBl.length ? '<div class="banner banner--bad" style="align-items:flex-start;padding:8px 12px">' + ic('exclamation-triangle') + '<span class="txt"><b>' + selBl.length + ' selected vendor' + (selBl.length > 1 ? ' are' : ' is') + ' Blacklisted: ' + selBl.map((v) => esc(v.name)).join(', ') + '.</b> ' + esc(selBl[0].note) + '<br><label class="chk" style="margin-top:6px;font-weight:600"><button class="chk" style="border:0;background:none;padding:0" role="checkbox" aria-checked="' + k.ack + '" data-a="ack"><span class="box ' + (k.ack ? 'on' : '') + '">' + (k.ack ? ic('check') : '') + '</span></button> I have read this and still want to add ' + (selBl.length > 1 ? 'them' : 'it') + '.</label></span></div>' : '';
    const filtered = k.q || k.cat !== 'all' || k.svc.length || k.area.length;
    const body = '<div style="display:flex;flex-direction:column;gap:12px"><div class="toolbar" style="flex-wrap:wrap"><label class="search" style="width:240px">' + ic('search') + '<input data-keep="pq" value="' + esc(k.q) + '" placeholder="Search vendors" aria-label="Search vendors"></label>' +
      dd('pk-cat', 'Category', 'single', k.cat, ['all', 'Preferred', 'Blacklisted'], []) + dd('pk-svc', 'Service', 'multi', '', D.SERVICES, k.svc) + dd('pk-area', 'Area', 'multi', '', D.AREAS, k.area) + (filtered ? '<button class="btn btn--text" data-a="pkclear">Clear</button>' : '') + '</div>' +
      '<div class="picklist" style="height:' + (selBl.length ? 250 : 336) + 'px">' + (rows.length ? list : '<div class="state" style="height:100%">' + ic('search') + '<p>No vendors match.</p><small>Blacklisted vendors are included in this list; check the Category filter.</small></div>') + '</div>' + warn + '</div>';
    const n = sel.length; const dis = n === 0 || (selBl.length && !k.ack);
    const foot = '<button class="btn" data-a="close">Cancel</button><span class="mid">' + n + ' selected' + (selBl.length ? ' (' + selBl.length + ' Blacklisted)' : '') + '</span><button class="btn btn--primary" data-a="save|Add Vendors"' + (dis ? ' disabled' : '') + '>' + (n ? 'Add ' + n + ' Vendor' + (n > 1 ? 's' : '') : 'Add Vendors') + '</button>';
    return dialog('Add Vendors', 'Acme Holdings v. Beta Corp (10482-0017). Linked vendors are shown but cannot be picked again.', 'dlg--lg', body, foot, true);
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
    if (S.drawer) h += drawer();
    const d = S.dialog;
    if (d === 'newVendor') h += vendorDialog(true); else if (d === 'editVendor') h += vendorDialog(false);
    else if (d === 'contactNote') h += noteDialog(); else if (d === 'addContact') h += addContactDialog(); else if (d === 'deleteVendor') h += deleteDialog();
    else if (d === 'listDlg') h += listDialog(); else if (d === 'picker') h += pickerDialog(); else if (d === 'teamAdd') h += teamDialog(); else if (d === 'personEdit') h += personDialog();
    if (S.toast) h += '<div class="toast" role="status"><b>' + S.toast + '</b></div>';
    return h;
  }

  /* ---------- matter Summary tab ---------- */
  const m1Vendors = () => D.VENDORS.filter((v) => v.links.some((l) => l[0] === 'm1')).sort((a, b) => (a.cat === b.cat ? a.name.localeCompare(b.name) : a.cat === 'Blacklisted' ? -1 : 1));
  const cap = () => (window.innerHeight >= 900 ? 5 : 4);
  function matterShell(content) {
    const tabs = [['summary', 'Summary', 'home', ''], ['tasks', 'Tasks', 'check-square', ' (14)'], ['projects', 'Projects', 'folder', ' (2)'], ['assets', 'Assets', 'database', ' (9)'], ['productions', 'Productions', 'send', ' (3)'], ['notes', 'Notes', 'file-edit', ' (6)'], ['activities', 'Activities', 'history', '']];
    return '<main class="main"><div class="crumb"><a href="#matter-summary">Matters</a>' + ic('chevron-right').replace('pi ', 'pi xs ') + '<span class="cur">10482-0017</span></div>' +
      '<div class="ph"><span class="tile">' + ic('folder') + '</span><h1>Acme Holdings v. Beta Corp</h1><span class="chip chip--ok">' + ic('check-circle') + 'Active</span><span class="sp"></span><button class="btn">' + ic('pencil') + 'Edit</button><button class="btn">' + ic('history') + 'Activity</button><button class="btn btn--primary">' + ic('plus') + 'New Task</button></div>' +
      '<div class="sub"><span class="mono" style="font-family:var(--mf-font-mono)">CM 10482-0017</span><span class="sep">|</span><span>Client: <a class="link" href="#matter-summary">Acme Holdings</a></span><span class="sep">|</span><span>Primary PM: Maria Alvarez</span></div>' +
      '<div class="tabs" role="tablist">' + tabs.map((x) => '<a class="tab" role="tab" href="#matter-summary" data-dead="1" aria-selected="' + (x[0] === 'summary') + '">' + ic(x[2]) + x[1] + x[3] + '</a>').join('') + '</div>' + content + '</main>';
  }
  const tl = (arr) => arr;
  function teamRows() { return S.teamEmpty ? [] : D.TEAM.map((t) => ({ t, p: D.person(t.pid) })); }
  function boxTeam() {
    const rows = teamRows(), n = rows.length, c = cap();
    const list = rows.slice(0, c).map((r) => '<li class="bx-row">' + av(r.p, true) + '<span class="bx-main"><b>' + pname(r.p) + '</b></span><span class="bx-role" title="' + esc(r.t.title) + '">' + esc(r.t.title) + '</span>' + typeChip(r.p).replace('chip ', 'chip bx-chip ') + '</li>').join('');
    return '<section class="card bx" aria-label="Team"><div class="bx-h"><h3>Team</h3><span class="cnt">' + n + '</span><span class="sp"></span>' + btn('Edit', 'ld|team|1', { icon: 'pencil' }) + '</div>' +
      (n ? '<ul class="bx-list" style="min-height:' + c * 36 + 'px">' + list + '</ul>' + (n > c ? '<div class="bx-f"><button class="btn btn--text" data-a="ld|team|0">Show All ' + n + '</button></div>' : '')
        : '<div class="bx-empty"><span class="muted">No team members yet.</span>' + btn('Add Member', 'dlg|teamAdd', { cls: 'btn--text' }) + '</div>') + '</section>';
  }
  function boxVendors() {
    const pe = P(); if (!pe.view) return '';
    const vs = S.teamEmpty ? [] : m1Vendors(), n = vs.length, c = cap(), bl = vs.filter((v) => v.cat === 'Blacklisted');
    const list = vs.slice(0, c).map((v) => '<li class="bx-row ' + (v.cat === 'Blacklisted' ? 'bx-warn' : '') + '"><span class="bx-main"><button class="btn btn--name" data-a="goto|vendor-drawer" title="' + esc(v.name) + '">' + esc(v.name) + '</button></span>' + (flagged(v, 'DNH') ? '<span style="color:var(--mf-danger)" title="Contact flagged Do Not Hire">' + ic('flag') + '</span>' : '') + catChip(v.cat).replace('chip ', 'chip bx-chip ') + '</li>').join('');
    const edit = pe.link ? btn('Edit', 'ld|vendors|1', { icon: 'pencil' }) : '<button class="btn" disabled aria-disabled="true" aria-describedby="whylink">' + ic('pencil') + 'Edit</button>';
    return '<section class="card bx" aria-label="Vendors"><div class="bx-h"><h3>Vendors</h3><span class="cnt">' + n + '</span>' + (bl.length ? '<span class="chip chip--bad bx-chip" title="' + esc(bl.map((v) => v.name).join(', ')) + '">' + ic('exclamation-triangle') + bl.length + ' Blacklisted</span>' : '') + '<span class="sp"></span>' + edit + '</div>' +
      (n ? '<ul class="bx-list" style="min-height:' + c * 36 + 'px">' + list + '</ul>' + (!pe.link ? '<div class="bx-f"><span class="why" id="whylink">' + ic('lock') + 'Needs Vendor.Link to change. Ask an administrator.</span><span class="sp"></span>' + (n > c ? '<button class="btn btn--text" data-a="ld|vendors|0">Show All ' + n + '</button>' : '') + '</div>' : (n > c ? '<div class="bx-f"><button class="btn btn--text" data-a="ld|vendors|0">Show All ' + n + '</button></div>' : ''))
        : '<div class="bx-empty"><span class="muted">No vendors linked yet.</span>' + (pe.link ? btn('Add Vendor', 'dlg|picker', { cls: 'btn--text' }) : '<span class="why" id="whylink">' + ic('lock') + 'Needs Vendor.Link.</span>') + '</div>') + '</section>';
  }
  function summaryPage() {
    const tiles = [['Hard Drives', 'database', 'slate', 12], ['Email Sets', 'at', 'blue', 4], ['Cloud Sources', 'globe', 'teal', 6], ['Chat Exports', 'comments', 'violet', 3], ['Production Volumes', 'box', 'orange', 3]];
    const f = (l, v, wide) => '<div class="df ' + (wide ? 'wide' : '') + '"><span class="dl">' + l + '</span><span class="dv">' + v + '</span></div>';
    const boxes = boxTeam() + boxVendors();
    return matterShell('<ul class="ms-tiles">' + tiles.map((t) => '<li class="card ms-tile"><span class="tt" style="background:var(--mf-tt-' + t[2] + ')">' + ic(t[1]) + '</span><span class="nm">' + t[0] + '</span><span class="ct">' + t[3] + '</span></li>').join('') + '</ul>' +
      '<div class="card ms-details"><div class="bx-h"><h3>Details</h3></div><div class="ms-fields">' +
      f('CM Number', '<span class="ms-cm">10482-0017</span>') + f('Client', '<a class="link mono" href="#matter-summary">1048</a> Acme Holdings') + f('Matter Number', '<span class="mono">0017</span>') + f('Matter Name', 'Acme Holdings v. Beta Corp') +
      f('Matter Type', 'Litigation') + f('Current State', 'Collection') + f('DMS Path', '<span class="mono">\\\\fs01\\dms\\Matters\\1048\\0017\\Acme v. Beta</span> <button class="btn btn--text">Copy</button>', 1) + f('DFS Path', '<span class="mono">https://dfs.example.com/matters/1048/0017</span> <button class="btn btn--text">Copy</button>', 1) +
      f('Status', '<span class="chip chip--ok">' + ic('check-circle') + 'Active</span>') + f('Primary PM', av(D.person('p1'), true) + ' Maria Alvarez') + f('Secondary PM', av(D.person('p3'), true) + ' Priya Nair') + f('AI Allowed', '<span class="chip">' + ic('sparkles') + 'Yes</span>') + f('Created', '02/03/2026') + f('Last Changed', '11/10/2026') +
      '</div></div><div class="bxrow ' + (P().view ? '' : 'one') + '">' + boxes + '</div>');
  }
  function listDialog() {
    const pe = P(); const k = S.ld; const edit = k.edit;
    if (k.kind === 'team') {
      const rows = teamRows();
      const body = '<div class="frame" style="box-shadow:none;flex:none"><table><colgroup><col><col style="width:124px"><col style="width:190px"><col style="width:176px">' + (edit ? '<col style="width:var(--mf-col-actions-w)">' : '') + '</colgroup><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Title</th>' + (edit ? '<th class="act"><span class="sr">Remove</span></th>' : '') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr><td><span class="two"><b>' + pname(r.p) + '</b></span><span class="two">' + esc(r.p.title) + (r.p.company ? ', ' + esc(r.p.company) : '') + '</span></td><td>' + typeChip(r.p) + '</td><td title="' + esc(r.p.email) + '">' + esc(r.p.email) + '</td><td>' + (edit ? '<span class="inp" style="height:32px"><select aria-label="Title for ' + pname(r.p) + '"><option>' + esc(r.t.title) + '</option></select></span>' : esc(r.t.title)) + '</td>' + (edit ? '<td class="act"><button class="btn btn--icon" aria-label="Remove ' + pname(r.p) + '">' + ic('trash') + '</button></td>' : '') + '</tr>').join('') + '</tbody></table></div>';
      return dialog('Team (' + rows.length + ')', 'Acme Holdings v. Beta Corp (10482-0017)', 'dlg--lg', body, edit ? '<button class="btn" data-a="close">Cancel</button><span class="mid">Titles and removals save with Save Changes.</span><button class="btn" data-a="dlg|teamAdd">' + ic('plus') + 'Add Member</button><button class="btn btn--primary" data-a="save|Save Changes" style="margin-left:8px">Save Changes</button>' : '<span class="sp"></span><button class="btn btn--primary" data-a="close">Close</button>');
    }
    const vs = m1Vendors(); const bl = vs.filter((v) => v.cat === 'Blacklisted');
    const body = (bl.length ? '<div class="banner banner--bad" style="margin-bottom:12px" role="note">' + ic('exclamation-triangle') + '<span class="txt"><b>' + esc(bl[0].name) + ' is Blacklisted</b> (' + bl[0].updated + '). It was linked before it was blacklisted. Review it before more work goes to it.</span><button class="btn btn--text" data-a="goto|vendor-drawer">View Vendor</button></div>' : '') +
      '<div class="frame" style="box-shadow:none;flex:none"><table><colgroup><col><col style="width:124px"><col style="width:150px"><col style="width:130px"><col style="width:100px">' + (edit ? '<col style="width:var(--mf-col-actions-w)">' : '') + '</colgroup><thead><tr><th>Vendor</th><th>Category</th><th>Services</th><th>Contacts</th><th>Linked</th>' + (edit ? '<th class="act"><span class="sr">Unlink</span></th>' : '') + '</tr></thead><tbody>' +
      vs.map((v) => { const cons = v.contacts.map((c) => D.person(c.pid)); const l = v.links.find((x) => x[0] === 'm1'); return '<tr class="' + (v.cat === 'Blacklisted' ? 'row-warn' : '') + '"><td><span class="two"><b>' + esc(v.name) + '</b></span><span class="two" style="font-family:var(--mf-font-mono)">' + esc(v.site) + '</span></td><td>' + catChip(v.cat) + '</td><td>' + tagsShort(v.svc, 16) + '</td><td>' + (cons.length ? pname(cons[0]) + (cons.length > 1 ? ' +' + (cons.length - 1) : '') : '<span class="muted">None</span>') + '</td><td><span class="two">' + l[1] + '</span><span class="two">' + esc(l[2]) + '</span></td>' + (edit ? '<td class="act"><button class="btn btn--icon" aria-label="Unlink ' + esc(v.name) + '">' + ic('minus-circle') + '</button></td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>';
    return dialog('Vendors (' + vs.length + ')', 'Acme Holdings v. Beta Corp (10482-0017)', 'dlg--lg', body, edit ? '<button class="btn" data-a="close">Cancel</button><span class="mid">Unlinking saves with Save Changes.</span><button class="btn" data-a="dlg|picker">' + ic('plus') + 'Add Vendor</button><button class="btn btn--primary" data-a="save|Save Changes" style="margin-left:8px">Save Changes</button>' : '<span class="sp"></span><button class="btn btn--primary" data-a="close">Close</button>');
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
      ['Vendor.View missing', 'Vendors menu item hidden. Opening the address shows Access Denied.', 'Vendors box hidden; the Team box fills the row.', 'Not reachable.'],
      ['Vendor.View only (no Manage)', 'Page and detail panel are read only: no New Vendor, row menu, Edit, Delete, Add Contact or Edit Note. Flags and notes stay readable.', 'Vendors box readable.', 'Not reachable.'],
      ['Vendor.Link missing', 'Unchanged.', 'Edit on the Vendors box shown disabled with the reason in the box footer. No Unlink.', 'Add Vendors picker not reachable.'],
      ['People.Manage missing', 'People page is read only: no New Person, no row menu, no Edit.', 'Team box unchanged (Edit needs Matter.Edit as today).', '"Add New Person" shown disabled with the reason. Existing people can still be picked.'],
      ['People.View missing', 'People menu item hidden. Opening the address shows Access Denied.', 'Team box unchanged.', 'Pickers still list everyone, for anyone who may edit a team or a vendor contact.'],
    ];
    return '<main class="main">' + head('lock', 'What a Person Without a Permission Sees', null, '', 'Rule of thumb: a whole page is hidden when the person has no business there; an action that is the point of a box they can read is shown disabled, with the reason in plain text next to it.') +
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
    noop: () => {}, close: () => { if (S.dialog) { S.dialog = null; S.menu = null; S.pp = { open: false, q: '' }; S.tm = { newOpen: false, picked: null }; } else S.drawer = null; S.keep = null; },
    guide: () => { S.guide = !S.guide; },
    drawer: (id) => { if (P().view) { S.drawer = id; S.dtab = 'overview'; S.menu = null; } },
    dtab: (t) => { S.dtab = t; },
    ld: (kind, e) => { S.ld = { kind, edit: e === '1' }; S.dialog = 'listDlg'; S.menu = null; },
    dlg: (n) => { S.dialog = n; S.menu = null; S.pp = { open: false, q: '' }; S.tm = { newOpen: false, picked: null }; if (n === 'newVendor') S.cvSel = { cat: 'Preferred', svc: [], area: [] }; if (n === 'picker') S.pk = { q: '', cat: 'all', svc: [], area: [], sel: [], ack: false }; if (n === 'personEdit') S.pe = 'new'; if (n === 'deleteVendor') S.dv = S.drawer; },
    menu: (id) => { S.menu = S.menu === id ? null : id; },
    ddset: (id, val) => setDd(id, val),
    clearf: () => { S.f = { q: '', cat: 'all', svc: [], area: [] }; S.menu = null; },
    pkclear: () => { S.pk.q = ''; S.pk.cat = 'all'; S.pk.svc = []; S.pk.area = []; S.menu = null; },
    edit: (id) => { S.dv = id; S.dialog = 'editVendor'; S.menu = null; S.cvSel = { cat: D.vendor(id).cat, svc: D.vendor(id).svc.slice(), area: D.vendor(id).area.slice() }; },
    del: (id) => { S.dv = id; S.dialog = 'deleteVendor'; S.menu = null; },
    cv: (g, x) => { if (g === 'cat') S.cvSel.cat = x; else S.cvSel[g] = toggle(S.cvSel[g], x); },
    note: (v, p) => { S.dctx = [v, p]; S.noteFlag = null; S.dialog = 'contactNote'; },
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
    save: (label) => { S.dialog = null; S.menu = null; S.toast = label + ': saved (demo only)'; setTimeout(() => { S.toast = null; render(); }, 2200); },
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
    if (k === 'vq') S.f.q = e.target.value; else if (k === 'pq') S.pk.q = e.target.value; else if (k === 'peq') S.pf.q = e.target.value; else if (k === 'pp') { S.pp.q = e.target.value; S.pp.open = true; }
    S.keep = k; render();
  });
  $root.addEventListener('change', (e) => { if (e.target.getAttribute('data-a') === 'persona') { S.persona = e.target.value; render(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (S.dialog || S.drawer || S.menu)) { if (S.menu) S.menu = null; else acts.close(); render(); } });
  window.addEventListener('hashchange', () => applyScreen(location.hash.slice(1)));
  applyScreen(location.hash.slice(1) || 'vendors');
})();
