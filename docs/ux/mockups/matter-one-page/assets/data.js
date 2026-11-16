/* Matter one-page mockup: demo data (invented). Today in the mockup is Monday 11/16/2026. */
window.D = (function () {
  const TODAY = new Date(2026, 10, 16, 10, 42);
  const pad = (n) => String(n).padStart(2, '0');
  const md = (off) => { const d = new Date(2026, 10, 16 + off); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()); };

  const matter = { cm: '00343-00012', cno: '00343', mno: '00012', client: 'Northgate Health Partners', name: 'Harborview Breach', type: 'Data Breach Response', category: 'Litigation Support', state: 'Review In Progress', created: '03/04/2026', changed: '11/13 04:12 PM', pm: 'p1', sec: 'p2' };

  const people = {
    p1: { n: 'Priya Raman', i: 'PR', t: 'Primary Project Manager', k: 'System User' },
    p2: { n: 'Marcus Webb', i: 'MW', t: 'Secondary Project Manager', k: 'System User' },
    p3: { n: 'Elena Duarte', i: 'ED', t: 'Data Technician', k: 'System User' },
    p4: { n: 'Tom Okafor', i: 'TO', t: 'Review Lead', k: 'System User' },
    p5: { n: 'Hannah Lindqvist', i: 'HL', t: 'Analyst', k: 'Internal' },
    p6: { n: 'Sam Whitfield', i: 'SW', t: 'Outside Counsel', k: 'External', co: 'Calloway & Reed LLP' },
    p7: { n: 'Dana Pruitt', i: 'DP', t: 'Data Technician', k: 'System User' }
  };
  const team = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const vendors = [
    { n: 'Lumen Forensics', cat: 'Forensics', flag: false },
    { n: 'Corvid Hosting', cat: 'Hosting', flag: false },
    { n: 'Pinewood Translations', cat: 'Translation', flag: true },
    { n: 'Atlas Court Reporting', cat: 'Court Reporting', flag: false }
  ];
  const assetTiles = [['Hard Drives', 'database', 'slate', 8], ['Email Sets', 'at', 'blue', 6], ['Cloud Sources', 'cloud', 'teal', 4], ['Chat Exports', 'comments', 'violet', 3], ['Mobile Devices', 'mobile', 'orange', 2]];

  /* task types: [name, icon, color] */
  const TT = { col: ['Collection', 'database', 'slate'], prc: ['Processing', 'cog', 'blue'], rev: ['Review', 'eye', 'violet'], qc: ['Quality Check', 'check-circle', 'teal'], prd: ['Production', 'send', 'orange'], ana: ['Analytics', 'chart-bar', 'indigo'], hst: ['Hosting', 'server', 'amber'] };
  const tpl = [
    ['col', 'Image laptop for custodian R. Ellis', 'High'], ['col', 'Collect Slack export, #incident-response', 'Normal'], ['prc', 'Process Volume 03 with OCR', 'Normal'],
    ['prc', 'Apply date and domain culling to Volume 02', 'Normal'], ['ana', 'Run email threading on custodian set 1', 'Normal'], ['rev', 'Load first-pass review batch 7', 'High'],
    ['rev', 'Prepare privilege log for batch 5', 'Critical'], ['qc', 'Spot-check coding on 500 documents', 'Normal'], ['hst', 'Increase workspace storage by 2 TB', 'Low'],
    ['prd', 'Build production volume PROD001', 'Critical'], ['qc', 'Verify Bates range and load file for PROD001', 'High'], ['col', 'Re-collect mailbox for departed custodian', 'High'],
    ['ana', 'Generate near-duplicate report', 'Low'], ['rev', 'Second-level review of hot documents', 'High'], ['prc', 'Re-process 14 exception files', 'Normal'],
    ['hst', 'Set review workspace permissions for outside counsel', 'Normal'], ['prd', 'Redact 62 documents for PROD002', 'High'], ['qc', 'Check de-duplication counts against Volume 01', 'Normal'], ['col', 'Document chain of custody for mobile devices', 'Normal']
  ];
  const st = ['progress', 'new', 'progress', 'hold', 'new', 'progress', 'new', 'progress', 'new', 'progress', 'hold', 'new'];
  const who = ['p3', 'p7', 'p3', 'p4', 'p5', 'p4', 'p1', 'p5', 'p7', 'p3', 'p2', 'p7', 'p5', 'p4', 'p3'];
  const tasks = [];
  for (let i = 0; i < 38; i++) {
    const t = tpl[i % tpl.length];
    const off = -4 + Math.floor(i * 0.85);
    tasks.push({ ref: 'TSK-' + (4102 + i * 7), type: t[0], title: t[1] + (i >= tpl.length ? ' - Round 2' : ''), pri: t[2], who: who[(i * 4 + (i % 3)) % who.length], due: off, time: i % 3 ? '05:00 PM' : '12:00 PM', status: st[(i * 7) % st.length] });
  }
  tasks.sort((a, b) => a.due - b.due);

  const projects = [
    ['Custodian Collection', 9, 2, 'Active'], ['Processing and Culling', 7, 1, 'Active'], ['First-Pass Review', 12, 3, 'Active'],
    ['Privilege Review', 6, 0, 'Active'], ['Rolling Production 01', 4, 0, 'Active'], ['Initial Triage', 0, 0, 'Archived']
  ].map((r) => ({ n: r[0], open: r[1], late: r[2], status: r[3] }));

  const aTypes = [['Hard Drive', 'database', 'slate'], ['Email Set', 'at', 'blue'], ['Cloud Source', 'cloud', 'teal'], ['Chat Export', 'comments', 'violet'], ['Mobile Device', 'mobile', 'orange']];
  const aNames = ['Laptop SSD, R. Ellis', 'Mailbox PST, J. Okonkwo', 'SharePoint site, Incident Response', 'Slack export, #incident-response', 'iPhone 14, L. Marsh', 'External HDD, finance share', 'Mailbox PST, R. Ellis', 'Google Drive, Legal', 'Teams export, Security', 'Android handset, K. Patel', 'Desktop HDD, M. Brandt', 'Mailbox PST, S. Haddad', 'OneDrive, Compliance'];
  const disp = ['In Storage', 'In Storage', 'Returned', 'In Storage', 'Pending Destruction', 'Destroyed'];
  const assets = [];
  for (let i = 0; i < 23; i++) {
    const ty = i % 5;
    assets.push({ type: aTypes[ty], n: 'AST-' + (2210 + i * 3) + ' ' + aNames[(i * 3) % aNames.length], size: (['1.0 TB', '38.2 GB', '512.0 GB', '4.6 GB', '128.0 GB', '2.0 TB', '16.4 GB'])[(i * 2) % 7], linked: (i * 5) % 9, ext: (i % 4 === 0) ? '' : 'NHP-' + (7000 + i * 11), disp: disp[(i * 5) % disp.length] });
  }

  const prodData = [
    { n: 'PROD001 Initial Production to Calloway & Reed', dir: 'Outgoing, Calloway & Reed', bates: 'NHP0000001 - NHP0048210', docs: 12840, spec: 'Standard TIFF + Text', due: 'Due 11/20 05:00 PM' },
    { n: 'PROD002 Supplemental, Privilege Redactions', dir: 'Outgoing, Calloway & Reed', bates: 'NHP0048211 - NHP0061954', docs: 3920, spec: 'Native + Redacted PDF', due: 'Due 12/04 05:00 PM' },
    { n: 'RCV001 Plaintiff Production', dir: 'Incoming, Marsh Dental Group', bates: 'MDG000001 - MDG020377', docs: 5206, spec: 'None', due: 'Delivered 10/27' }
  ];

  const tags = [['Handoff', 'blue'], ['Protocol', 'teal'], ['Custodian', 'violet'], ['Client Call', 'amber'], ['Hold', 'slate'], ['Workflow', 'indigo']];
  const noteT = ['Kickoff call with client counsel', 'Custodian interview summary, R. Ellis', 'Search term negotiation, round 2', 'Handoff notes for the review team', 'ESI protocol, agreed changes', 'Weekly status, 11/09', 'Vendor call, Lumen Forensics', 'Privilege protocol for batch 5', 'Mobile device collection plan', 'Client request: extend hold to Finance', 'Weekly status, 11/02', 'Production specification questions', 'Hosting cost estimate', 'Custodian list, final'];
  const notes = noteT.map((t, i) => ({ t, tag: tags[(i * 2) % tags.length], who: ['p1', 'p2', 'p4', 'p1', 'p5', 'p2'][i % 6], upd: i < 2 ? 'Today' : i < 4 ? 'Yesterday' : md(-(i * 2)) }));

  const acts = [
    ['p3', 'completed task TSK-4137 Process Volume 03 with OCR'], ['p4', 'added a comment on TSK-4151 Prepare privilege log for batch 5'], ['p1', 'created task TSK-4249 Set review workspace permissions'],
    ['p7', 'changed the status of TSK-4165 to In Progress'], ['p2', 'linked asset AST-2237 to the matter'], ['p5', 'edited the note "Handoff notes for the review team"'],
    ['p1', 'changed the Current State to Review In Progress'], ['p3', 'added production PROD002 Supplemental, Privilege Redactions'], ['p4', 'reassigned TSK-4158 from Hannah Lindqvist to Tom Okafor'],
    ['p2', 'added Corvid Hosting to the vendors of the matter']
  ];
  const when = ['5 m ago', '41 m ago', '2 h ago', '3 h ago', '5 h ago', 'Yesterday', 'Yesterday', '11/12', '11/12', '11/11', '11/10', '11/10'];
  const activities = [];
  for (let i = 0; i < 12; i++) { const a = acts[i % acts.length]; activities.push({ when: when[i], who: a[0], what: a[1] }); }

  return { TODAY, md, matter, people, team, vendors, assetTiles, TT, tasks, projects, assets, prodData, notes, activities, counts: { tasks: 38, projects: 6, assets: 23, productions: 3, notes: 14, activities: 1284 } };
})();
