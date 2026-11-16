/* Integrations mockup (#1395, epic #1389): invented data only. No real tenant, client or secret exists here; every ID is an obvious fake.
   "Today" is fixed so the screens read the same on every day: Monday 11/16/2026, 09:30 AM. */
(function () {
  const TODAY = new Date(2026, 10, 16, 9, 30);
  const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const days = (n) => { const d = new Date(2026, 10, 16 + n); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const pad = (n) => String(n).padStart(2, '0');
  /* D-60: a date is MM/DD this year, MM/DD/YYYY otherwise; an instant is MM/DD hh:mm AM/PM (year added when not this year). */
  const md = (s) => { const [y, m, d] = s.split('-'); return +y === 2026 ? m + '/' + d : m + '/' + d + '/' + y; };
  const inst = (s) => { const d = new Date(s); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + (d.getFullYear() === 2026 ? '' : '/' + d.getFullYear()) + ' ' + pad(h) + ':' + pad(d.getMinutes()) + ' ' + ap; };
  const longDate = (s) => { const [y, m, d] = s.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] + ' ' + +d + ', ' + y; };
  const daysFromToday = (s) => { const [y, m, d] = s.split('-'); return Math.round((new Date(+y, m - 1, +d) - new Date(2026, 10, 16)) / 864e5); };

  const IDS = { tenant: 'aaaaaaaa-0000-4000-8000-000000000001', client: 'bbbbbbbb-0000-4000-8000-000000000002', lookupApp: 'cccccccc-0000-4000-8000-000000000003', wallApp: 'dddddddd-0000-4000-8000-000000000004' };
  const URLS = { lookup: 'https://matters.example-firm.test/api/v1', wall: 'https://walls.example-firm.test/api' };
  const scope = (id) => 'api://' + id + '/.default';
  const T = (d, h, mi) => new Date(2026, 10, 16 + d, h, mi).toISOString();

  /* a scene = the whole starting state of the page. Everything is a plain copy so clicking around never changes the next scene. */
  const SCENES = {
    'first-use': {
      label: 'First use: nothing set up yet', note: 'The state on the day this ships: no connection, both integrations seeded and Not set up.',
      entra: { tenant: '', client: '', secret: false, expires: '', updated: null, test: null },
      list: [
        { id: 1, name: 'Matter Lookup', type: 'Matter Lookup', base: '', scope: '', enabled: true, tested: null },
        { id: 2, name: 'Ethical Wall', type: 'Ethical Wall', base: '', scope: '', enabled: true, tested: null }
      ]
    },
    'lookup-pending': {
      label: 'Connection works, Matter Lookup waits for IT', note: 'Entra ID is set up and tested. The Matter Lookup API is entered but IT has not started it, so its test fails. Ethical Wall is connected.',
      entra: { tenant: IDS.tenant, client: IDS.client, secret: true, expires: '2027-03-18', updated: { at: T(-4, 14, 15), by: 'Priya Raman' }, test: { at: T(-1, 16, 42), by: 'Priya Raman', result: 'ok' } },
      list: [
        { id: 1, name: 'Matter Lookup', type: 'Matter Lookup', base: URLS.lookup, scope: scope(IDS.lookupApp), enabled: true, tested: { at: T(-1, 16, 44), by: 'Priya Raman', result: 'unreachable' } },
        { id: 2, name: 'Ethical Wall', type: 'Ethical Wall', base: URLS.wall, scope: scope(IDS.wallApp), enabled: true, tested: { at: T(-1, 16, 45), by: 'Priya Raman', result: 'ok' } }
      ]
    },
    working: {
      label: 'Everything connected', note: 'Both integrations tested and Connected; the secret has 122 days left.',
      entra: { tenant: IDS.tenant, client: IDS.client, secret: true, expires: '2027-03-18', updated: { at: T(-12, 11, 5), by: 'Priya Raman' }, test: { at: T(-1, 16, 42), by: 'Priya Raman', result: 'ok' } },
      list: [
        { id: 1, name: 'Matter Lookup', type: 'Matter Lookup', base: URLS.lookup, scope: scope(IDS.lookupApp), enabled: true, tested: { at: T(-1, 16, 44), by: 'Priya Raman', result: 'ok' } },
        { id: 2, name: 'Ethical Wall', type: 'Ethical Wall', base: URLS.wall, scope: scope(IDS.wallApp), enabled: true, tested: { at: T(-1, 16, 45), by: 'Priya Raman', result: 'ok' } }
      ]
    },
    expiring: {
      label: 'Secret expires in 21 days', note: 'Everything still works. The amber banner and chip ask for a new secret before 12/07.',
      entra: { tenant: IDS.tenant, client: IDS.client, secret: true, expires: days(21), updated: { at: T(-340, 10, 0), by: 'Priya Raman' }, test: { at: T(-1, 16, 42), by: 'Priya Raman', result: 'ok' } },
      list: [
        { id: 1, name: 'Matter Lookup', type: 'Matter Lookup', base: URLS.lookup, scope: scope(IDS.lookupApp), enabled: true, tested: { at: T(-1, 16, 44), by: 'Priya Raman', result: 'ok' } },
        { id: 2, name: 'Ethical Wall', type: 'Ethical Wall', base: URLS.wall, scope: scope(IDS.wallApp), enabled: true, tested: { at: T(-1, 16, 45), by: 'Priya Raman', result: 'ok' } }
      ]
    },
    expired: {
      label: 'Secret has expired', note: 'The secret ran out 6 days ago. Every integration fails its test with the same plain reason.',
      entra: { tenant: IDS.tenant, client: IDS.client, secret: true, expires: days(-6), updated: { at: T(-370, 10, 0), by: 'Priya Raman' }, test: { at: T(-5, 8, 12), by: 'Priya Raman', result: 'expired' } },
      list: [
        { id: 1, name: 'Matter Lookup', type: 'Matter Lookup', base: URLS.lookup, scope: scope(IDS.lookupApp), enabled: true, tested: { at: T(-5, 8, 14), by: 'Priya Raman', result: 'expired' } },
        { id: 2, name: 'Ethical Wall', type: 'Ethical Wall', base: URLS.wall, scope: scope(IDS.wallApp), enabled: true, tested: { at: T(-5, 8, 15), by: 'Priya Raman', result: 'expired' } }
      ]
    },
    mixed: {
      label: 'All four statuses and an Other type', note: 'One row per status (Connected, Failed, Disabled, Not set up) plus a configured one that was never tested.',
      entra: { tenant: IDS.tenant, client: IDS.client, secret: true, expires: '2027-03-18', updated: { at: T(-12, 11, 5), by: 'Priya Raman' }, test: { at: T(-1, 16, 42), by: 'Priya Raman', result: 'ok' } },
      list: [
        { id: 1, name: 'Matter Lookup', type: 'Matter Lookup', base: URLS.lookup, scope: scope(IDS.lookupApp), enabled: true, tested: { at: T(-1, 16, 44), by: 'Priya Raman', result: 'ok' } },
        { id: 2, name: 'Ethical Wall', type: 'Ethical Wall', base: URLS.wall, scope: scope(IDS.wallApp), enabled: true, tested: { at: T(-3, 9, 5), by: 'Priya Raman', result: 'scope' } },
        { id: 3, name: 'Conflict Check Feed', type: 'Other', base: 'https://conflicts.example-firm.test/feed', scope: 'api://eeeeeeee-0000-4000-8000-000000000005/.default', enabled: false, tested: { at: T(-20, 15, 30), by: 'Dana Whitfield', result: 'ok' } },
        { id: 4, name: 'Records Hold Notices', type: 'Other', base: '', scope: '', enabled: true, tested: null },
        { id: 5, name: 'Billing Export', type: 'Other', base: 'https://billing.example-firm.test/export', scope: 'api://ffffffff-0000-4000-8000-000000000006/.default', enabled: true, tested: null }
      ]
    },
    empty: {
      label: 'No integrations in the list', note: 'The connection is set up but both seeded entries were deleted. The empty state offers Add Integration.',
      entra: { tenant: IDS.tenant, client: IDS.client, secret: true, expires: '2027-03-18', updated: { at: T(-12, 11, 5), by: 'Priya Raman' }, test: { at: T(-1, 16, 42), by: 'Priya Raman', result: 'ok' } },
      list: []
    },
    loading: { label: 'Loading', note: 'First load: skeletons with the final layout (D-50).', alias: 'working', loading: true },
    error: { label: 'Load error', note: 'The list could not be loaded: inline error with Retry, no toast (D-51).', alias: 'working', error: true }
  };

  /* the plain-language copy for every test outcome (the "copy table"). Steps: 0 reach Entra ID, 1 credentials accepted, 2 token for the scope, 3 the API answers. */
  const STEPS = ['Reached Microsoft Entra ID', 'Credentials accepted', 'Token issued for the scope', 'The API answered'];
  const RESULTS = {
    ok: { fail: -1, tone: 'ok' },
    notset: { fail: 0, tone: 'info', title: 'Not set up yet.' },
    entra: { fail: 0, tone: 'bad', title: 'Couldn\'t reach Microsoft Entra ID.' },
    creds: { fail: 1, tone: 'bad', title: 'Entra ID refused the credentials.' },
    expired: { fail: 1, tone: 'bad', title: 'The client secret has expired.' },
    scope: { fail: 2, tone: 'bad', title: 'Entra ID refused the scope.' },
    unreachable: { fail: 3, tone: 'bad', title: 'The API is not reachable.' }
  };
  const TEST_CHOICES = [['auto', 'Automatic (follows the data)'], ['ok', 'Success'], ['notset', 'Not set up yet'], ['entra', 'Entra ID not reachable'], ['creds', 'Credentials refused'], ['expired', 'Secret expired'], ['scope', 'Scope refused'], ['unreachable', 'API not reachable']];

  window.D = { TODAY, days, md, inst, longDate, daysFromToday, IDS, URLS, scope, SCENES, STEPS, RESULTS, TEST_CHOICES, person: 'Priya Raman',
    audit: [
      { at: T(-1, 16, 45), who: 'Priya Raman', what: 'Tested the Ethical Wall integration: Connected' },
      { at: T(-1, 16, 42), who: 'Priya Raman', what: 'Tested the Microsoft Entra ID connection: Connected' },
      { at: T(-4, 14, 15), who: 'Priya Raman', what: 'Replaced the client secret; new expiry 03/18/2027' },
      { at: T(-4, 14, 12), who: 'Priya Raman', what: 'Changed the Matter Lookup integration: Base URL and Scope' }
    ] };
})();
