/* Integrations mockup (#1395, epic #1389): Administration > Settings > Integrations. Tiny renderer, no framework, no network, nothing saves, no app code.
   URL options (all optional):
     ?scene=first-use|lookup-pending|working|expiring|expired|mixed|empty|loading|error   the starting data (default first-use)
     ?secret=none|ok|soon|expired      force the secret state on top of the scene
     ?viewer=admin|limited|none        administrator | can open Settings but not Integrations | cannot open Settings at all
     ?tab=integrations|branding|dashboard|holidays      the Settings tab (default integrations)
     ?view=settings|lookup             the Settings page, or the note page "How the Lookup button behaves"
     ?dialog=add|edit|replace|delete   open a dialog on load (edit and delete act on the first row)
     ?test=ok|notset|entra|creds|expired|scope|unreachable|running   show a finished (or running) Matter Lookup test result on load
     ?next=auto|ok|notset|entra|creds|expired|scope|unreachable      what the next Test Connection click returns (default auto)
     ?lookup=admin                     the Lookup note page as an administrator sees it
     ?chrome=0 hides the mockup guide, ?guide=1 opens it. */
(function () {
  const D = window.D;
  const Q = new URLSearchParams(location.search);
  const $root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ic = (n, c) => '<i class="pi pi-' + n + (c ? ' ' + c : '') + '" aria-hidden="true"></i>';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  if (Q.get('chrome') === '0') document.body.classList.add('nochrome');

  /* ---------- state ---------- */
  const S = { scene: Q.get('scene') || 'first-use', secret: Q.get('secret') || '', viewer: Q.get('viewer') || 'admin', tab: Q.get('tab') || 'integrations', view: Q.get('view') || 'settings',
    next: Q.get('next') || 'auto', guide: Q.get('guide') === '1', lkAdmin: Q.get('lookup') === 'admin', toasts: [], menu: null, dlg: null, result: null, run: null, lk: {}, form: null, nextId: 100, loadFail: false, interactive: false };
  let E, LIST; /* the connection and the integrations as they are saved */
  function load() {
    const sc = D.SCENES[S.scene] || D.SCENES['first-use']; const base = sc.alias ? D.SCENES[sc.alias] : sc;
    E = clone(base.entra); LIST = clone(base.list);
    if (S.secret === 'none') { E.secret = false; E.expires = ''; }
    else if (S.secret === 'ok') { E.secret = true; E.expires = '2027-03-18'; }
    else if (S.secret === 'soon') { E.secret = true; E.expires = D.days(21); }
    else if (S.secret === 'expired') { E.secret = true; E.expires = D.days(-6); }
    S.form = { tenant: E.tenant, client: E.client, errors: {} };
    S.result = null; S.dlg = null; S.menu = null; S.toasts = []; S.run = null;
    S.loadState = sc.loading ? 'loading' : sc.error ? 'error' : 'ready';
  }
  load();

  /* ---------- derived facts ---------- */
  function sec() {
    if (!E.secret) return { k: 'none' };
    const n = D.daysFromToday(E.expires);
    if (n < 0) return { k: 'expired', n: -n };
    if (n <= 30) return { k: 'soon', n };
    return { k: 'ok', n };
  }
  const entraComplete = () => !!(E.tenant && E.client && E.secret);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function status(i) {
    if (!i.enabled) return 'disabled';
    if (!entraComplete() || !i.base || !i.scope) return 'notset';
    if (sec().k === 'expired') return 'failed';
    if (!i.tested) return 'untested';
    return i.tested.result === 'ok' ? 'ok' : 'failed';
  }
  const STATUS = { ok: ['Connected', 'check-circle', 'ok'], notset: ['Not Set Up', 'info-circle', 'info'], failed: ['Failed', 'times-circle', 'bad'], disabled: ['Disabled', 'ban', 'off'], untested: ['Not Tested', 'question-circle', 'neutral'] };
  const chip = (k, label, icon, tone) => '<span class="chip chip--' + tone + '">' + ic(icon) + label + '</span>';
  const statusChip = (k) => chip(k, STATUS[k][0], STATUS[k][1], STATUS[k][2]);
  const SCOPE_EX = 'api://<app-id>/.default';

  /* ---------- test outcomes: plain language ---------- */
  function detail(key, c) {
    const how = c.entra ? 'Entra ID accepted' : 'Entra ID issued a token for ';
    switch (key) {
      case 'ok': return c.entra ? 'Entra ID accepted the Tenant ID, Client ID and Client Secret. A token stays valid for about 1 h 14 m.' : 'Entra ID issued a token for ' + c.scope + ', valid for 1 h 14 m, and ' + c.name + ' answered.';
      case 'notset': return c.entra ? 'Enter the Tenant ID, Client ID and Client Secret, then test again. Nothing was sent to Microsoft.' : 'Enter the Tenant ID, Client ID and Client Secret in the connection above, and the Base URL and Scope of this integration, then test again. Nothing was sent.';
      case 'entra': return 'login.microsoftonline.com did not answer. Check that this server may reach the internet through the firewall, then test again.';
      case 'creds': return 'The Tenant ID, Client ID or Client Secret is wrong. Check them against the app registration in the Azure portal.';
      case 'expired': return 'Entra ID no longer accepts the secret that expired on ' + D.md(E.expires || D.days(-6)) + '. Create a new secret in the Azure portal, then use Replace Secret.';
      case 'scope': return 'The scope ' + c.scope + ' is not allowed for this app registration. Ask IT to grant it admin consent, or check the scope text.';
      case 'unreachable': return 'Entra ID issued a token, but ' + (c.base || 'the Base URL') + ' did not answer. Check the Base URL, and that IT has started the service.';
    }
    return '';
  }
  function derive(target) {
    if (S.next !== 'auto') return S.next;
    if (!entraComplete()) return 'notset';
    if (sec().k === 'expired') return 'expired';
    if (target === 'entra') return 'ok';
    if (!target.base || !target.scope) return 'notset';
    return target.sim || (S.scene === 'lookup-pending' && target.id === 1 ? 'unreachable' : 'ok');
  }
  const stepIcon = (state) => state === 'ok' ? ic('check-circle') : state === 'bad' ? ic('times-circle') : state === 'run' ? ic('spinner', 'pi-spin') : ic('minus-circle');
  function stepsHtml(r) {
    const n = r.entra ? 2 : 4; const failAt = r.state === 'running' ? -2 : D.RESULTS[r.state].fail;
    let h = '<ol class="steps">';
    for (let i = 0; i < n; i++) {
      let st = 'idle', note = 'Not checked';
      if (r.state === 'running') { st = i < r.step ? 'ok' : i === r.step ? 'run' : 'idle'; note = st === 'ok' ? '' : st === 'run' ? 'Checking...' : 'Waiting'; }
      else if (failAt === -1 || i < failAt) { st = 'ok'; note = ''; }
      else if (i === failAt) { st = 'bad'; note = 'Stopped here'; }
      h += '<li class="step step--' + st + '">' + stepIcon(st) + '<span>' + D.STEPS[i] + '</span>' + (note ? '<span class="muted">' + note + '</span>' : '') + '</li>';
    }
    return h + '</ol>';
  }
  function resultBlock(r) {
    const c = { name: r.name, scope: r.scope, base: r.base, entra: r.entra };
    if (r.state === 'running') return '<div class="res res--run" role="status" aria-live="polite"><div class="res-h">' + ic('spinner', 'pi-spin') + '<b>Testing ' + esc(r.name) + '...</b></div>' + stepsHtml(r) + '</div>';
    const R = D.RESULTS[r.state]; const ok = r.state === 'ok';
    const title = ok ? 'Connection works.' : R.title;
    return '<div class="res res--' + (ok ? 'ok' : R.tone) + '" role="' + (ok ? 'status' : 'alert') + '"><div class="res-h">' + ic(ok ? 'check-circle' : R.tone === 'info' ? 'info-circle' : 'times-circle') + '<b>' + title + '</b><span class="sp"></span><span class="muted sm" title="' + esc(D.longDate('2026-11-16')) + ', 9:30 AM">' + 'Just now, ' + esc(r.by) + '</span></div><p>' + esc(detail(r.state, c)) + '</p>' + stepsHtml(r) + '</div>';
  }

  /* ---------- toasts (D-52) ---------- */
  function toast(kind, title, detail, sticky) {
    const t = { id: ++S.nextId, kind, title, detail, sticky };
    S.toasts.push(t); if (S.toasts.length > 3) S.toasts.shift();
    if (kind !== 'error' && !sticky) setTimeout(() => { S.toasts = S.toasts.filter((x) => x.id !== t.id); drawToasts(); }, kind === 'success' ? 4000 : 6000);
    drawToasts();
  }
  function drawToasts() {
    const el = document.getElementById('toasts'); if (!el) return;
    el.innerHTML = S.toasts.map((t) => '<div class="toast toast--' + t.kind + '" role="' + (t.kind === 'error' ? 'alert' : 'status') + '">' + ic(t.kind === 'error' ? 'times-circle' : t.kind === 'success' ? 'check-circle' : 'info-circle') + '<div class="tt"><b>' + esc(t.title) + '</b>' + (t.detail ? '<span>' + esc(t.detail) + '</span>' : '') + '</div><button class="btn btn--icon" aria-label="Close" data-a="toastx|' + t.id + '">' + ic('times') + '</button></div>').join('');
  }

  /* ---------- running a test ---------- */
  function runTest(targetId) {
    if (S.run) return;
    const entra = targetId === 'entra'; const it = entra ? null : LIST.find((x) => x.id === +targetId);
    const name = entra ? 'Microsoft Entra ID connection' : it.name;
    const key = derive(entra ? 'entra' : it);
    const r = { entra, id: entra ? 'entra' : it.id, name, scope: it && it.scope, base: it && it.base, by: D.person, state: 'running', step: 0 };
    if (entra) S.result = { ...r, hold: true, entraOnly: true }; else S.result = r;
    S.run = r; S.interactive = true; render();
    const failAt = key === 'ok' ? 99 : D.RESULTS[key].fail; const n = entra ? 2 : 4; let i = 0;
    const tick = () => {
      i++;
      if (i < n && i <= failAt) { r.step = i; S.result.step = i; render(); setTimeout(tick, 550); return; }
      r.state = key; const stamp = new Date(2026, 10, 16, 9, 30).toISOString();
      if (entra) { E.test = { at: stamp, by: D.person, result: key }; S.result = { ...r, state: key }; }
      else { it.tested = { at: stamp, by: D.person, result: key }; S.result = { ...r, state: key }; }
      S.run = null; render();
      if (key === 'ok') toast('success', 'Connection tested', name + ': token valid for 1 h 14 m.');
      else toast('error', 'Couldn\'t connect ' + (entra ? 'to Microsoft Entra ID' : name) + '.', D.RESULTS[key].title);
    };
    setTimeout(tick, 650);
  }

  /* ---------- frame ---------- */
  const NAVMAIN = [['chart-bar', 'Dashboard'], ['briefcase', 'My Matters'], ['list-check', 'My Work'], ['building', 'Clients'], ['folder', 'Matters'], ['address-book', 'People'], ['users', 'Pod Work'], ['list', 'Task Queue']];
  const NAVADMIN = [['users', 'Users'], ['sliders-h', 'Task Types'], ['list', 'Lists'], ['database', 'Asset Types'], ['sliders-v', 'Custom Fields'], ['file', 'Report Setup'], ['history', 'Audit Logs'], ['cog', 'Settings']];
  function nav() {
    const a = (i, l, cur) => '<a href="#" data-dead="1"' + (cur ? ' aria-current="page"' : '') + '>' + ic(i) + l + '</a>';
    const cur = S.view === 'lookup' ? 'Matters' : 'Settings';
    return '<nav class="nav" aria-label="Main"><div class="logo"><i>LH</i>LPT Hub</div>' + NAVMAIN.map(([i, l]) => a(i, l, l === cur)).join('') +
      (S.viewer === 'none' ? '' : '<div class="sec">Administration</div>' + NAVADMIN.map(([i, l]) => a(i, l, l === cur)).join('')) + '</nav>';
  }
  const top = () => '<header class="top"><div class="gs">' + ic('search') + 'Search clients, matters, tasks, assets...<kbd>Ctrl+K</kbd></div><span class="sp"></span><button class="btn btn--primary" data-dead="1">' + ic('plus') + 'New Task</button><button class="btn btn--icon" aria-label="Notifications" data-dead="1">' + ic('bell') + '</button><span class="avatar" title="' + D.person + '">PR</span></header>';

  const TABS = [['branding', 'Branding', 'palette'], ['dashboard', 'Dashboard', 'gauge'], ['holidays', 'Holidays', 'flag'], ['integrations', 'Integrations', 'link']];
  const tabsList = () => TABS.filter((t) => t[0] !== 'integrations' || S.viewer === 'admin');
  function pageHeader() {
    return '<nav class="crumb" aria-label="Breadcrumb"><span>Administration</span>' + ic('chevron-right', 'xs') + '<span class="cur">Settings</span></nav>' +
      '<div class="ph"><span class="tile">' + ic('cog') + '</span><h1>Settings</h1></div><p class="pdesc">Application settings for everyone who uses this system.</p>' +
      '<div class="tabs" role="tablist" aria-label="Settings sections">' + tabsList().map(([k, l, i]) => '<button class="tab" role="tab" id="settings-tab-' + k + '" aria-selected="' + (S.tab === k) + '" data-a="tab|' + k + '">' + ic(i) + l + '</button>').join('') + '</div>';
  }

  /* ---------- Microsoft Entra ID connection card ---------- */
  function secretBlock() {
    const s = sec(); const exp = E.expires;
    let state, line, btn;
    if (s.k === 'none') { state = '<span class="secbox">' + ic('lock-open') + '<span>Not set</span></span>'; line = '<span class="chip chip--neutral">' + ic('minus-circle') + 'Not Set</span><span class="muted">No secret yet, so nothing can sign in.</span>'; btn = '<button class="btn btn--primary" data-a="dlg|replace">' + ic('key') + 'Set Secret</button>'; }
    else {
      state = '<span class="secbox">' + ic('lock') + '<span>Secret set</span></span>'; btn = '<button class="btn" data-a="dlg|replace">' + ic('refresh') + 'Replace Secret</button>';
      const when = '<span title="' + esc(D.longDate(exp)) + '">Expires ' + D.md(exp) + '</span>';
      if (s.k === 'ok') line = when + chip('', 'Expires in ' + plural(s.n, 'day'), 'check-circle', 'ok');
      else if (s.k === 'soon') line = when + chip('', 'Expires in ' + plural(s.n, 'day'), 'exclamation-triangle', 'risk');
      else line = '<span title="' + esc(D.longDate(exp)) + '">Expired ' + D.md(exp) + '</span>' + chip('', 'Expired ' + plural(s.n, 'day') + ' ago', 'times-circle', 'bad');
    }
    return '<div class="fld"><label class="lbl" for="secbox">Client Secret <span class="req">(required)</span></label><div class="secrow">' + state.replace('class="secbox"', 'class="secbox" id="secbox"') + btn + '<div class="secline">' + line + '</div></div><p class="help">Stored encrypted. It can\'t be shown again, not even to administrators. LPT Hub warns 30 days before it expires.</p></div>';
  }
  function entraOverall() {
    const s = sec();
    if (!entraComplete()) return chip('', 'Not Set Up', 'info-circle', 'info');
    if (s.k === 'expired') return chip('', 'Secret Expired', 'times-circle', 'bad');
    if (!E.test) return chip('', 'Not Tested', 'question-circle', 'neutral');
    return E.test.result === 'ok' ? chip('', 'Connected', 'check-circle', 'ok') : chip('', 'Failed', 'times-circle', 'bad');
  }
  function lastTest() {
    if (S.result && S.result.entraOnly) return resultBlock(S.result);
    if (!E.test) return '<p class="muted lt">' + ic('clock') + 'Last Tested: never. Test Connection asks Entra ID for a token with the credentials above.</p>';
    const ok = E.test.result === 'ok';
    return '<p class="lt">' + ic('clock') + '<span class="muted">Last Tested</span> <span title="' + esc(D.inst(E.test.at)) + '">' + D.inst(E.test.at) + '</span> by ' + esc(E.test.by) + ': ' + (ok ? chip('', 'Connected', 'check-circle', 'ok') + '<span class="muted">Entra ID accepted the credentials.</span>' : chip('', 'Failed', 'times-circle', 'bad') + '<span>' + esc(D.RESULTS[E.test.result].title) + '</span>') + '</p>';
  }
  function dirty() { return S.form.tenant !== E.tenant || S.form.client !== E.client; }
  const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  function idField(id, label, val, err, help) {
    return '<div class="fld"><label class="lbl" for="' + id + '">' + label + ' <span class="req">(required)</span></label><input class="inp mono' + (err ? ' inp--err' : '') + '" id="' + id + '" data-f="' + id + '" value="' + esc(val) + '" autocomplete="off" spellcheck="false" aria-describedby="' + id + '-h"' + (err ? ' aria-invalid="true"' : '') + '>' +
      (err ? '<p class="err" role="alert">' + ic('exclamation-circle') + err + '</p>' : '') + '<p class="help" id="' + id + '-h">' + help + '</p></div>';
  }
  function entraCard() {
    if (S.loadState === 'loading') return '<section class="card cardx" aria-busy="true"><div class="card-h"><h2>Microsoft Entra ID Connection</h2></div><div class="card-b"><div class="skgrid"><span class="sk" style="width:60%"></span><span class="sk" style="width:80%"></span><span class="sk" style="width:50%"></span></div></div></section>';
    const er = S.form.errors;
    return '<section class="card cardx" aria-labelledby="h-entra" data-card="entra"><div class="card-h"><div class="grow"><h2 id="h-entra">Microsoft Entra ID Connection</h2><p class="sub2">One app registration for every integration. Each integration asks Entra ID for its own scope.</p></div>' + entraOverall() + '</div>' +
      '<div class="card-b"><div class="cols2">' +
      idField('tenant', 'Tenant ID', S.form.tenant, er.tenant, 'The Directory (tenant) ID on the Overview page of the app registration.') +
      idField('client', 'Client ID', S.form.client, er.client, 'The Application (client) ID on the same page. LPT Hub signs in as this app.') +
      '</div>' + secretBlock() +
      '<div class="testrow"><div class="testbtn"><button class="btn" data-a="test|entra"' + (S.run ? ' disabled' : '') + '>' + ic('bolt') + 'Test Connection</button>' + lastTest() + '</div><p class="help">Checks that Entra ID can be reached and accepts the credentials. Each integration is tested on its own row below.</p></div></div>' +
      '<div class="card-f"><span class="note" id="dirtynote">' + (dirty() ? '' : 'No unsaved changes') + '</span><span class="note">Last Updated ' + (E.updated ? D.inst(E.updated.at) + ' by ' + esc(E.updated.by) : 'never') + '. Changes go to Audit Logs; the secret value never does.</span><span class="sp"></span><button class="btn" id="cancel" data-a="cancelform"' + (dirty() ? '' : ' disabled') + '>Cancel</button><button class="btn btn--primary" id="save" data-a="saveform"' + (dirty() ? '' : ' disabled') + '>Save Changes</button></div>' +
      '</section>';
  }

  /* ---------- banner (D-10a) ---------- */
  function banner() {
    const s = sec();
    if (S.loadState !== 'ready') return '';
    if (s.k === 'expired') return '<div class="banner banner--bad" role="alert">' + ic('times-circle') + '<span class="txt"><b>The client secret expired on ' + D.md(E.expires) + '.</b> Every integration fails until it is replaced.</span><button class="btn btn--sm" data-a="dlg|replace">Replace Secret</button></div>';
    if (s.k === 'soon') return '<div class="banner banner--risk" role="status">' + ic('exclamation-triangle') + '<span class="txt"><b>The client secret expires in ' + plural(s.n, 'day') + ' (' + D.md(E.expires) + ').</b> Replace it before then or every integration stops working.</span><button class="btn btn--sm" data-a="dlg|replace">Replace Secret</button></div>';
    return '';
  }

  /* ---------- Integrations grid ---------- */
  const COLS = [['Name', '184px'], ['Type', '120px'], ['Base URL', ''], ['Scope', '208px'], ['Enabled', '84px'], ['Status', '136px'], ['Last Tested', '136px'], ['', 'var(--mf-col-actions-w)']];
  const dash = '<span class="muted" title="Not set">-</span>';
  function why(i, st) {
    if (st === 'failed') return sec().k === 'expired' ? 'The client secret has expired.' : D.RESULTS[i.tested.result].title;
    if (st === 'notset') return !entraComplete() ? 'The Microsoft Entra ID connection is not complete yet.' : 'Base URL or Scope is missing.';
    if (st === 'disabled') return 'Turned off. The integration is kept but never called.';
    if (st === 'untested') return 'Everything is entered. Run Test Connection to check it.';
    return 'Last test succeeded.';
  }
  function rowHtml(i) {
    const st = status(i); const open = S.menu === i.id;
    const last = i.tested ? '<span title="' + esc(D.longDate('2026-11-16')) + ' by ' + esc(i.tested.by) + '">' + D.inst(i.tested.at) + '</span>' : '<span class="muted">Never</span>';
    const running = S.run && S.run.id === i.id;
    return '<tr' + (i.enabled ? '' : ' class="off"') + '><td><button class="btn btn--name" data-a="dlg|edit|' + i.id + '" title="' + esc(i.name) + '">' + esc(i.name) + '</button></td><td>' + esc(i.type) + '</td><td title="' + esc(i.base) + '">' + (i.base ? esc(i.base) : dash) + '</td><td class="mono sm" title="' + esc(i.scope) + '">' + (i.scope ? esc(i.scope) : dash) + '</td><td>' + (i.enabled ? 'Yes' : '<span class="muted">No</span>') + '</td><td title="' + esc(why(i, st)) + '">' + (running ? chip('', 'Testing...', 'spinner', 'neutral').replace('pi-spinner', 'pi-spinner pi-spin') : statusChip(st)) + '</td><td>' + last + '</td>' +
      '<td class="act"><button class="btn btn--icon" aria-label="Actions for ' + esc(i.name) + '" aria-haspopup="menu" aria-expanded="' + open + '" data-a="menu|' + i.id + '">' + ic('ellipsis-h') + '</button>' +
      (open ? '<div class="menu" role="menu"><button role="menuitem" data-a="dlg|edit|' + i.id + '">' + ic('pencil') + 'Edit</button><button role="menuitem" data-a="test|' + i.id + '">' + ic('bolt') + 'Test Connection</button><button role="menuitem" data-a="toggle|' + i.id + '">' + ic(i.enabled ? 'ban' : 'play') + (i.enabled ? 'Disable' : 'Enable') + '</button><hr><button role="menuitem" class="dng" data-a="dlg|delete|' + i.id + '">' + ic('trash') + 'Delete</button></div>' : '') + '</td></tr>';
  }
  function gridBody() {
    const colg = '<colgroup>' + COLS.map((c) => '<col' + (c[1] ? ' style="width:' + c[1] + '"' : '') + '>').join('') + '</colgroup>';
    const thead = '<thead><tr>' + COLS.map((c) => '<th' + (c[0] ? '' : ' class="act"') + '>' + (c[0] || '<span class="sr">Actions</span>') + '</th>').join('') + '</tr></thead>';
    if (S.loadState === 'loading') { let r = ''; for (let n = 0; n < 2; n++) r += '<tr>' + COLS.map((c, j) => '<td><span class="sk' + (j === 5 ? ' sk--chip' : '') + '" style="width:' + (j === 7 ? 20 : 40 + ((n * 23 + j * 31) % 50)) + (j === 7 ? 'px' : '%') + '"></span></td>').join('') + '</tr>'; return '<div role="status" aria-busy="true"><table>' + colg + thead + '<tbody>' + r + '</tbody></table><span class="sr">Loading integrations</span></div>'; }
    if (S.loadState === 'error') return '<table>' + colg + thead + '</table><div class="state sec-state" role="alert">' + ic('exclamation-triangle', 'warn') + '<p>Couldn\'t load integrations.</p><small>The server did not answer.</small><button class="btn" data-a="retry">' + ic('refresh') + 'Retry</button></div>';
    if (!LIST.length) return '<table>' + colg + thead + '</table><div class="state sec-state">' + ic('link') + '<p>No integrations yet.</p><small>An integration is one API that LPT Hub calls, such as Matter Lookup or Ethical Wall. It uses the connection above.</small><button class="btn btn--primary" data-a="dlg|add">' + ic('plus') + 'Add Integration</button></div>';
    return '<table>' + colg + thead + '<tbody>' + LIST.map(rowHtml).join('') + '</tbody></table>';
  }
  function resultPanel() {
    if (!S.result || S.result.entraOnly) return '';
    return '<div class="rp"><h3>Test Result: ' + esc(S.result.name) + '</h3>' + resultBlock(S.result) + '</div>';
  }
  function integrationsCard() {
    return '<section class="card cardx" aria-labelledby="h-int" data-card="list"><div class="card-h"><div class="grow"><h2 id="h-int">Integrations</h2><p class="sub2">Each integration is one API that LPT Hub calls. It uses the connection above and asks Entra ID for its own scope.</p></div>' +
      (S.loadState === 'ready' && LIST.length ? '<button class="btn btn--primary" data-a="dlg|add">' + ic('plus') + 'Add Integration</button>' : '') + '</div>' +
      '<div class="gridwrap">' + gridBody() + '</div>' + resultPanel() + '</section>';
  }
  function recent() {
    if (S.loadState !== 'ready' || !E.updated) return '';
    return '<section class="card cardx" aria-labelledby="h-rec"><div class="card-h"><div class="grow"><h2 id="h-rec">Recent Changes</h2><p class="sub2">Who changed or tested what. Secret values are never written here.</p></div></div><ul class="aud">' + D.audit.map((a) => '<li><span class="when" title="' + esc(D.inst(a.at)) + '">' + D.inst(a.at) + '</span><span class="who">' + esc(a.who) + '</span><span class="what">' + esc(a.what) + '</span></li>').join('') + '</ul><div class="sec-f"><span class="sp"></span><a class="btn btn--text" href="#" data-dead="1">Open Audit Logs' + ic('arrow-right') + '</a></div></section>';
  }
  function integrationsTab() {
    return banner() + entraCard() + integrationsCard() + recent();
  }
  function stub(tab) {
    return '<section class="card cardx"><div class="state sec-state">' + ic('cog') + '<p>' + (TABS.find((t) => t[0] === tab) || [])[1] + ' looks and works as today.</p><small>This tab is not part of the mockup. Use the Integrations tab.</small></div></section>';
  }
  function noAccess(what) {
    return '<section class="card cardx"><div class="state sec-state" role="alert">' + ic('lock') + '<p>You don\'t have access to ' + what + '.</p><small>' + (what === 'Integrations' ? 'Only administrators with the Integrations permission can see or change them.' : 'Ask an administrator if you need it.') + '</small></div></section>';
  }
  function settingsPage() {
    if (S.viewer === 'none') return '<main class="main" id="main"><div class="page"><div class="ph"><span class="tile">' + ic('lock') + '</span><h1>Settings</h1></div>' + noAccess('Settings') + '</div></main>';
    let tab = S.tab; if (!tabsList().some((t) => t[0] === tab)) { if (tab === 'integrations') return '<main class="main" id="main"><div class="page">' + pageHeader() + noAccess('Integrations') + '</div></main>'; tab = 'branding'; }
    return '<main class="main" id="main"><div class="page">' + pageHeader() + '<div id="settings-panel" role="tabpanel" aria-labelledby="settings-tab-' + tab + '">' + (tab === 'integrations' ? integrationsTab() : stub(tab)) + '</div></div></main>';
  }

  /* ---------- dialogs (D-31, D-32, D-35, D-30) ---------- */
  const field = (id, label, req, control, help, err) => '<div class="fld"><label class="lbl" for="' + id + '">' + label + (req ? ' <span class="req">(required)</span>' : '') + '</label>' + control + (err ? '<p class="err" role="alert">' + ic('exclamation-circle') + err + '</p>' : '') + (help ? '<p class="help" id="' + id + '-h">' + help + '</p>' : '') + '</div>';
  function dialog(title, sub, body, foot, size) {
    return '<div class="scrim" data-scrim="1"><div class="dlg dlg--' + (size || 'md') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="dlg-h"><div><h2 id="dlg-t">' + title + '</h2>' + (sub ? '<p class="muted sm">' + sub + '</p>' : '') + '</div><button class="btn btn--icon" aria-label="Close" data-a="dlgx">' + ic('times') + '</button></div><div class="dlg-b">' + body + '</div><div class="dlg-f">' + foot + '</div></div></div>';
  }
  function formDialog() {
    const d = S.dlg, v = d.v, er = d.errors;
    const typeOpts = ['Matter Lookup', 'Ethical Wall', 'Other'].map((t) => '<option' + (v.type === t ? ' selected' : '') + '>' + t + '</option>').join('');
    const body = field('f-name', 'Name', true, '<input class="inp' + (er.name ? ' inp--err' : '') + '" id="f-name" data-d="name" value="' + esc(v.name) + '" autocomplete="off">', 'Shown in this list and in messages, for example Matter Lookup.', er.name) +
      field('f-type', 'Type', true, '<select class="inp sel' + (er.type ? ' inp--err' : '') + '" id="f-type" data-d="type">' + typeOpts + '</select>', 'Matter Lookup powers the Lookup button on New Client and New Matter. Ethical Wall checks who may join a matter. Other is for any further API.', er.type) +
      field('f-base', 'Base URL', true, '<input class="inp mono' + (er.base ? ' inp--err' : '') + '" id="f-base" data-d="base" value="' + esc(v.base) + '" autocomplete="off" spellcheck="false">', 'The address of the API, for example <span class="mono">' + esc(D.URLS.lookup) + '</span>. Only https addresses are accepted.', er.base) +
      field('f-scope', 'Scope', true, '<input class="inp mono' + (er.scope ? ' inp--err' : '') + '" id="f-scope" data-d="scope" value="' + esc(v.scope) + '" autocomplete="off" spellcheck="false">', 'What LPT Hub asks Entra ID for when it calls this API. Usually <span class="mono">' + esc(SCOPE_EX) + '</span>, where <span class="mono">&lt;app-id&gt;</span> is the Application ID of the API\'s own app registration, for example <span class="mono">' + esc(D.scope(D.IDS.lookupApp)) + '</span>.', er.scope) +
      '<div class="fld"><label class="chk"><input type="checkbox" data-d="enabled"' + (v.enabled ? ' checked' : '') + '><span>Enabled</span></label><p class="help">A disabled integration is kept but never called. Turn it off to stop using it without deleting it.</p></div>';
    return dialog(d.mode === 'add' ? 'Add Integration' : 'Edit Integration', d.mode === 'edit' ? esc(d.v.name) : '', body, '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn btn--primary" data-a="dlgsave">' + (d.mode === 'add' ? 'Add Integration' : 'Save Changes') + '</button>');
  }
  function replaceDialog() {
    const d = S.dlg, er = d.errors; const first = !E.secret;
    const body = '<p class="lead">' + (first ? 'Paste the secret from the Azure portal.' : 'The new secret replaces the old one at once. Create it in the Azure portal first; the old one keeps working there until it expires or you delete it.') + '</p>' +
      field('r-secret', 'Client Secret Value', true, '<input class="inp mono' + (er.secret ? ' inp--err' : '') + '" id="r-secret" type="password" data-d="secret" value="' + esc(d.secret) + '" autocomplete="new-password" spellcheck="false">', 'Paste the secret <b>Value</b>, not the Secret ID. It is stored encrypted and can\'t be shown again.', er.secret) +
      field('r-exp', 'Expires On', true, '<input class="inp' + (er.exp ? ' inp--err' : '') + '" id="r-exp" type="date" lang="en-US" data-d="exp" value="' + esc(d.exp) + '">', 'The expiry date the Azure portal shows next to the secret. LPT Hub warns administrators 30 days before.', er.exp);
    return dialog(first ? 'Set Client Secret' : 'Replace Client Secret', 'Microsoft Entra ID connection', body, '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn btn--primary" data-a="dlgsave">Save Secret</button>');
  }
  function deleteDialog() {
    const it = LIST.find((x) => x.id === S.dlg.id);
    const note = it.type === 'Matter Lookup' ? ' The Lookup button on New Client and New Matter stays off until you add it again.' : it.type === 'Ethical Wall' ? ' Ethical wall checks stop until you add it again.' : '';
    return dialog('Delete Integration', '', '<p class="lead">' + esc(it.name) + ' will be removed.' + note + ' This can\'t be undone, but you can add it again.</p>', '<button class="btn" data-a="dlgx">Cancel</button><span class="sp"></span><button class="btn btn--solid-danger" data-a="dlgsave">Delete Integration</button>', 'sm');
  }
  const dialogHtml = () => !S.dlg ? '' : S.dlg.kind === 'form' ? formDialog() : S.dlg.kind === 'replace' ? replaceDialog() : deleteDialog();

  function openDlg(kind, id) {
    S.menu = null;
    if (kind === 'add') S.dlg = { kind: 'form', mode: 'add', v: { name: '', type: 'Other', base: '', scope: '', enabled: true }, errors: {} };
    else if (kind === 'edit') { const it = LIST.find((x) => x.id === +id); S.dlg = { kind: 'form', mode: 'edit', id: it.id, v: { name: it.name, type: it.type, base: it.base, scope: it.scope, enabled: it.enabled }, errors: {} }; }
    else if (kind === 'replace') S.dlg = { kind: 'replace', secret: '', exp: '2028-11-16', errors: {} };
    else if (kind === 'delete') S.dlg = { kind: 'delete', id: +id };
  }
  function validateForm(d) {
    const v = d.v, er = {};
    if (!v.name.trim()) er.name = 'Enter a name.';
    const dup = LIST.find((x) => x.type === v.type && v.type !== 'Other' && x.id !== d.id);
    if (dup) er.type = 'There is already a ' + v.type + ' integration (' + dup.name + '). Edit it, or choose Other.';
    if (!/^https:\/\/\S+$/.test(v.base.trim())) er.base = v.base.trim() ? 'The Base URL must start with https://.' : 'Enter the Base URL.';
    if (!v.scope.trim()) er.scope = 'Enter the scope, for example ' + SCOPE_EX + '.';
    return er;
  }
  function saveDlg() {
    const d = S.dlg; if (!d) return;
    if (d.kind === 'form') {
      d.errors = validateForm(d); if (Object.keys(d.errors).length) { renderDialogOnly(); return; }
      const v = d.v;
      if (d.mode === 'add') { LIST.push({ id: ++S.nextId, name: v.name.trim(), type: v.type, base: v.base.trim(), scope: v.scope.trim(), enabled: v.enabled, tested: null }); toast('success', 'Integration added', v.name.trim() + '. Run Test Connection to check it.'); }
      else { const it = LIST.find((x) => x.id === d.id); const changed = it.base !== v.base.trim() || it.scope !== v.scope.trim(); Object.assign(it, { name: v.name.trim(), type: v.type, base: v.base.trim(), scope: v.scope.trim(), enabled: v.enabled }); if (changed) it.tested = null; toast('success', 'Integration saved', v.name.trim() + (changed ? '. Its last test no longer applies.' : '.')); }
    } else if (d.kind === 'replace') {
      const er = {};
      if (!d.secret.trim()) er.secret = 'Enter the secret value.';
      else if (GUID.test(d.secret.trim())) er.secret = 'That looks like the Secret ID. Paste the secret Value instead.';
      if (!d.exp || d.exp <= '2026-11-16') er.exp = 'Enter a date after today.';
      d.errors = er; if (Object.keys(er).length) { renderDialogOnly(); return; }
      E.secret = true; E.expires = d.exp; E.test = null; E.updated = { at: new Date(2026, 10, 16, 9, 30).toISOString(), by: D.person };
      toast('success', 'Secret saved', 'It expires ' + D.md(d.exp) + '. Run Test Connection to check it.');
    } else if (d.kind === 'delete') {
      const it = LIST.find((x) => x.id === d.id); LIST = LIST.filter((x) => x.id !== d.id); if (S.result && S.result.id === d.id) S.result = null; toast('success', 'Integration deleted', it.name + ' was removed.');
    }
    S.dlg = null; S.interactive = true; render();
  }

  /* ---------- Lookup button note page (New Matter and New Client) ---------- */
  const LKTIP = { notset: 'Lookup isn\'t set up yet. An administrator can set it up in Administration > Settings > Integrations.', off: 'Lookup is turned off. An administrator can turn it on in Administration > Settings > Integrations.' };
  function lkCard(key, dlgTitle, fieldLabel, val, caption, mode) {
    const st = S.lk[key] || { s: mode.start || 'idle' };
    const disabledTip = mode.kind === 'notset' ? LKTIP.notset : mode.kind === 'off' ? LKTIP.off : '';
    let btn, msg = '';
    if (disabledTip) {
      btn = '<span class="tipwrap"><button class="btn" aria-disabled="true" aria-describedby="tip-' + key + '" data-dead="1">' + ic('search') + 'Lookup</button><span class="tipbox" role="tooltip" id="tip-' + key + '">' + esc(disabledTip) + '</span></span>';
      msg = '<p class="help lkmsg">' + ic('info-circle') + (mode.kind === 'off' ? 'Lookup is turned off. Enter the details yourself.' : 'Lookup isn\'t available yet. Enter the details yourself.') + (S.lkAdmin ? ' <button class="btn btn--text" data-dead="1">Open Integrations</button>' : '') + '</p>';
    } else {
      btn = '<button class="btn" data-a="lk|' + key + '|' + mode.kind + '"' + (st.s === 'busy' ? ' aria-busy="true"' : '') + '>' + (st.s === 'busy' ? ic('spinner', 'pi-spin') + 'Looking up...' : ic('search') + 'Lookup') + '</button>';
      if (st.s === 'ok') msg = '<p class="help lkmsg lk-ok">' + ic('check-circle') + 'Found matter 26-0417. Client and Matter Name were filled in. Check them before you save.</p>';
      if (st.s === 'fail') msg = '<p class="err lkmsg" role="alert">' + ic('exclamation-circle') + 'Couldn\'t look up that CM Number. The matter system did not answer. Enter the details yourself, or <button class="btn btn--text" data-a="lk|' + key + '|' + mode.kind + '">Retry</button></p>';
      if (st.s === 'none') msg = '<p class="err lkmsg" role="alert">' + ic('exclamation-circle') + 'No matter found for CM Number 26-9999. Check the number, or enter the details yourself.</p>';
    }
    const filled = st.s === 'ok';
    const rows = mode.client ? field('lk-' + key, fieldLabel, true, '<div class="withbtn"><input class="inp" id="lk-' + key + '" value="' + esc(filled ? 'Harbor Bay Logistics' : val) + '" readonly>' + btn + '</div>', '', '') + msg + field('lk2-' + key, 'Client Number', false, '<input class="inp mono" id="lk2-' + key + '" value="' + (filled ? 'C-10442' : '') + '" readonly>', '', '')
      : field('lk0-' + key, 'Client', true, '<input class="inp" value="' + esc(filled ? 'Harbor Bay Logistics' : '') + '" readonly aria-label="Client">', '', '') + field('lk-' + key, fieldLabel, true, '<div class="withbtn"><input class="inp mono" id="lk-' + key + '" value="' + esc(val) + '" readonly>' + btn + '</div>', '', '') + msg + field('lk2-' + key, 'Matter Name', true, '<input class="inp" value="' + esc(filled ? 'Port Authority Dispute' : '') + '" readonly aria-label="Matter Name">', '', '');
    return '<figure class="lkfig"><div class="dlg dlg--md dlg--static"><div class="dlg-h"><div><h2>' + dlgTitle + '</h2></div><span class="btn btn--icon" aria-hidden="true">' + ic('times') + '</span></div><div class="dlg-b">' + rows + '<p class="clip muted sm">' + ic('ellipsis-h') + ' more fields</p></div></div><figcaption><b>' + mode.label + '</b><span>' + caption + '</span></figcaption></figure>';
  }
  function lookupPage() {
    const c = [
      lkCard('a', 'New Matter', 'CM Number', '26-0417', 'Matter Lookup is Connected. Lookup is on. A match fills Client and Matter Name; the person still checks them and saves. Click Lookup to try.', { kind: 'ready', label: 'Ready: Connected' }),
      lkCard('b', 'New Matter', 'CM Number', '', 'Not Set Up (no Base URL or Scope, or the connection is incomplete). Lookup stays visible but is disabled, so people learn it exists. The tooltip says why and who can fix it; the sentence under the field shows the same without hovering. Typing by hand always works.', { kind: 'notset', label: 'Not set up' }),
      lkCard('c', 'New Matter', 'CM Number', '', 'An administrator turned the integration off (Enabled = No). Same look, a different tooltip.', { kind: 'off', label: 'Disabled' }),
      lkCard('d', 'New Matter', 'CM Number', '26-0417', 'Connected on paper, but the call fails now (API down, secret expired). Lookup is on; the error sits under the field with Retry. Click Lookup to see it.', { kind: 'fail', label: 'Fails when used', start: 'idle' }),
      lkCard('e', 'New Matter', 'CM Number', '26-9999', 'Lookup works but finds nothing. Plain sentence, no toast. Click Lookup to see it.', { kind: 'none', label: 'Nothing found' }),
      lkCard('f', 'New Client', 'Client Name', '', 'New Client has the same rule. Shown Not Set Up.', { kind: 'notset', label: 'New Client, not set up', client: true })
    ].join('');
    return '<main class="main" id="main"><div class="page"><div class="banner">' + ic('info-circle') + '<span class="txt"><b>Mockup note, not a screen.</b> What a person sees at the top of New Matter and New Client when the Matter Lookup integration is in each state. Field layout is simplified; only the Lookup button and its messages are proposed.</span></div>' +
      '<div class="lkbar"><div class="seg" role="group" aria-label="Viewer"><button aria-pressed="' + !S.lkAdmin + '" data-a="lkadmin|0">Everyone</button><button aria-pressed="' + S.lkAdmin + '" data-a="lkadmin|1">Administrator</button></div><span class="muted sm">An administrator also gets a text button, Open Integrations, next to the sentence. The tooltip and sentence are the same for everyone.</span></div>' +
      '<div class="lkgrid">' + c + '</div></div></main>';
  }

  /* ---------- mockup guide (not product) ---------- */
  function guide() {
    const sel = (k, opts, cur) => '<select data-s="' + k + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    const sc = D.SCENES[S.scene] || {};
    return '<button class="mk-pill" data-a="guide" aria-expanded="' + S.guide + '">' + ic('book') + 'Mockup Guide</button><div class="mk-badge">Mockup: no app code, nothing saves</div>' +
      (S.guide ? '<div class="mk-panel" role="dialog" aria-label="Mockup guide"><h2>Settings > Integrations</h2><p>Issue #1395, epic #1389. Desktop only: 1366x768 and 1920x1080. Today is 11/16/2026 here. All IDs are fake.</p>' +
        '<h3>Screen</h3><a href="#" data-a="goto|settings|integrations" ' + (S.view === 'settings' && S.tab === 'integrations' ? 'aria-current="true"' : '') + '>Settings > Integrations tab</a><a href="#" data-a="goto|lookup|" ' + (S.view === 'lookup' ? 'aria-current="true"' : '') + '>Lookup button on New Matter and New Client</a><a href="#" data-a="goto|settings|branding">Another Settings tab (unchanged)</a>' +
        '<h3>Starting data</h3><label>Scene' + sel('scene', Object.keys(D.SCENES).map((k) => [k, D.SCENES[k].label]), S.scene) + '</label><p>' + esc(sc.note || '') + '</p>' +
        '<label>Secret' + sel('secret', [['', 'As the scene'], ['none', 'Not set'], ['ok', 'Set, 122 days left'], ['soon', 'Expires in 21 days'], ['expired', 'Expired 6 days ago']], S.secret) + '</label>' +
        '<label>Next Test Connection returns' + sel('next', D.TEST_CHOICES, S.next) + '</label>' +
        '<label>Viewer' + sel('viewer', [['admin', 'Administrator'], ['limited', 'Can open Settings, no Integrations'], ['none', 'No access to Settings']], S.viewer) + '</label>' +
        '<h3>Open</h3><div class="row wrap"><button class="btn" data-a="open|add">Add</button><button class="btn" data-a="open|edit">Edit</button><button class="btn" data-a="open|replace">Replace Secret</button><button class="btn" data-a="open|delete">Delete</button></div>' +
        '<p>Test states: set "Next Test Connection returns", then use the Test Connection button on a row. Or open <span class="mono">?test=scope</span> (and ok, notset, entra, creds, expired, unreachable, running).</p>' +
        '<hr><p>URL options: ?scene= ?secret= ?viewer= ?tab= ?view=lookup ?dialog= ?test= ?next= ?lookup=admin ?chrome=0 ?guide=1. See README.md.</p></div>' : '');
  }

  /* ---------- render ---------- */
  function renderDialogOnly() {
    const host = document.getElementById('dlghost'); if (!host) return render();
    const focusId = document.activeElement && document.activeElement.id; host.innerHTML = dialogHtml(); if (focusId) { const f = document.getElementById(focusId); if (f) f.focus(); }
    const first = host.querySelector('.err') && host.querySelector('.inp--err'); if (first) first.focus();
  }
  function render() {
    const m = document.getElementById('main'); const st = m ? m.scrollTop : 0; const ae = document.activeElement; const fid = ae && ae.id && !S.dlg ? ae.id : null; const sel = fid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
    $root.innerHTML = '<div class="app">' + nav() + top() + (S.view === 'lookup' ? lookupPage() : settingsPage()) + '</div><div id="dlghost">' + dialogHtml() + '</div><div id="toasts" aria-live="polite"></div>' + guide();
    const m2 = document.getElementById('main'); if (m2) m2.scrollTop = st;
    if (fid) { const f = document.getElementById(fid); if (f) { f.focus(); if (sel && f.setSelectionRange) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
    if (S.dlg) { const f = document.querySelector('#dlghost .inp') || document.querySelector('#dlghost .dlg-f .btn'); if (f && !document.activeElement.closest('#dlghost')) f.focus(); }
    drawToasts();
  }

  /* ---------- events ---------- */
  const acts = {
    guide: () => { S.guide = !S.guide; },
    tab: (k) => { S.tab = k; S.menu = null; },
    menu: (id) => { S.menu = S.menu === +id ? null : +id; },
    dlg: (k, id) => openDlg(k, id), dlgx: () => { S.dlg = null; },
    dlgsave: () => { saveDlg(); return 'skip'; },
    test: (id) => { S.menu = null; runTest(id); return 'skip'; },
    toggle: (id) => { const it = LIST.find((x) => x.id === +id); it.enabled = !it.enabled; S.menu = null; toast('success', 'Integration ' + (it.enabled ? 'enabled' : 'disabled'), it.name + (it.enabled ? ' is on again.' : ' is kept but no longer called.')); },
    toastx: (id) => { S.toasts = S.toasts.filter((t) => t.id !== +id); drawToasts(); return 'skip'; },
    retry: () => { S.loadState = 'ready'; },
    cancelform: () => { S.form.tenant = E.tenant; S.form.client = E.client; S.form.errors = {}; },
    saveform: () => {
      const er = {}; if (!GUID.test(S.form.tenant.trim())) er.tenant = 'Enter the Tenant ID as 36 characters, like ' + D.IDS.tenant + '.'; if (!GUID.test(S.form.client.trim())) er.client = 'Enter the Client ID as 36 characters, like ' + D.IDS.client + '.';
      S.form.errors = er; if (Object.keys(er).length) return;
      E.tenant = S.form.tenant.trim(); E.client = S.form.client.trim(); E.test = null; E.updated = { at: new Date(2026, 10, 16, 9, 30).toISOString(), by: D.person }; toast('success', 'Connection saved', 'Run Test Connection to check it.');
    },
    goto: (v, t) => { S.view = v; if (t) S.tab = t; S.menu = null; S.dlg = null; },
    open: (k) => { openDlg(k, LIST[0] && LIST[0].id); S.guide = false; },
    lkadmin: (v) => { S.lkAdmin = v === '1'; },
    lk: (key, kind) => {
      const was = S.lk[key]; if (was && was.s === 'busy') return 'skip';
      S.lk[key] = { s: 'busy' }; render();
      setTimeout(() => { S.lk[key] = { s: kind === 'ready' ? 'ok' : kind === 'fail' ? 'fail' : kind === 'none' ? 'none' : 'ok' }; render(); }, 700); return 'skip';
    }
  };
  document.addEventListener('click', (e) => {
    if (S.menu != null && !e.target.closest('.menu') && !e.target.closest('[data-a^="menu|"]')) { S.menu = null; render(); }
    if (e.target.matches && e.target.matches('[data-scrim]') && S.dlg) { S.dlg = null; render(); return; }
    const dead = e.target.closest('[data-dead]'); if (dead) { e.preventDefault(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const [a, ...args] = b.getAttribute('data-a').split('|');
    if (acts[a]) { e.preventDefault(); S.interactive = true; const r = acts[a](...args); if (r !== 'skip') render(); }
  });
  document.addEventListener('input', (e) => {
    const f = e.target.getAttribute && e.target.getAttribute('data-f');
    if (f) { S.form[f] = e.target.value; S.form.errors[f] = ''; const d = dirty(); const s = document.getElementById('save'), c = document.getElementById('cancel'), n = document.getElementById('dirtynote'); if (s) s.disabled = !d; if (c) c.disabled = !d; if (n) n.textContent = d ? '' : 'No unsaved changes'; return; }
    const k = e.target.getAttribute && e.target.getAttribute('data-d'); if (!k || !S.dlg) return;
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (S.dlg.v) { S.dlg.v[k] = val; if (S.dlg.errors[k]) { S.dlg.errors[k] = ''; if (k === 'type') renderDialogOnly(); } if (k === 'type') { S.dlg.errors = {}; S.dlg.v.type = val; const dup = LIST.find((x) => x.type === val && val !== 'Other' && x.id !== S.dlg.id); if (dup) S.dlg.errors.type = 'There is already a ' + val + ' integration (' + dup.name + '). Edit it, or choose Other.'; renderDialogOnly(); } }
    else S.dlg[k] = val;
  });
  document.addEventListener('change', (e) => {
    const k = e.target.getAttribute && e.target.getAttribute('data-s'); if (!k) return;
    S[k] = e.target.value; S.guide = true;
    if (k === 'scene' || k === 'secret') load();
    S.interactive = true; sync(); render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (S.dlg) { S.dlg = null; render(); } else if (S.menu != null) { S.menu = null; render(); } }
    if (e.key === 'Tab' && S.dlg) { const els = [...document.querySelectorAll('#dlghost button, #dlghost input, #dlghost select')].filter((x) => !x.disabled); if (!els.length) return; const first = els[0], last = els[els.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } else if (!document.activeElement.closest('#dlghost')) { e.preventDefault(); first.focus(); } }
  });
  function sync() { try { const p = new URLSearchParams(); if (S.scene !== 'first-use') p.set('scene', S.scene); if (S.secret) p.set('secret', S.secret); if (S.viewer !== 'admin') p.set('viewer', S.viewer); if (S.next !== 'auto') p.set('next', S.next); if (S.guide) p.set('guide', '1'); if (Q.get('chrome') === '0') p.set('chrome', '0'); history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : '')); } catch (e) {} }

  /* presets from the URL */
  const T0 = Q.get('test');
  if (T0 && S.loadState === 'ready') {
    const it = LIST[0]; if (it) {
      const st = T0 === 'running' ? 'running' : T0;
      S.result = { entra: false, id: it.id, name: it.name, scope: it.scope, base: it.base, by: D.person, state: st, step: 2 };
      if (st !== 'running') { it.tested = { at: new Date(2026, 10, 16, 9, 30).toISOString(), by: D.person, result: st }; setTimeout(() => { if (!S.interactive) toast(st === 'ok' ? 'success' : 'error', st === 'ok' ? 'Connection tested' : 'Couldn\'t connect ' + it.name + '.', st === 'ok' ? it.name + ': token valid for 1 h 14 m.' : D.RESULTS[st].title, true); }, 0); }
    }
  }
  const DG = Q.get('dialog'); if (DG) openDlg(DG, LIST[0] && LIST[0].id);
  render();
  if (Q.get('toast') === 'ok') toast('success', 'Secret saved', 'It expires 03/18/2027. Run Test Connection to check it.', true);
})();
