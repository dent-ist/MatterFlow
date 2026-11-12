/* Sample data for the Vendor Management mockup. All names, firms and addresses are invented (example.com / example.test). */
window.MF = (function () {
  const TODAY = '11/12/2026';
  const SERVICES = ['eDiscovery', 'Forensic', 'Review', 'Custom Development', 'Forensic Accounting', 'ITAR', 'Translation', 'Managed Services'];
  const AREAS = ['US', 'Canada', 'EU', 'UK', 'Asia Pacific', 'Middle East'];
  const TEAM_TITLES = ['Lead Attorney', 'Case Manager', 'Technical Lead', 'Client Contact', 'Billing Contact', 'Opposing Counsel'];

  /* People. type: int (works at the firm) | ext. user: true = has a MatterFlow login (kept in sync with Administration > Users). */
  const PEOPLE = [
    { id: 'p1', first: 'Maria', last: 'Alvarez', type: 'int', user: true, title: 'Project Manager', email: 'maria.alvarez@lawfirm.example', company: '', comments: '', used: { m: 6, v: 0 } },
    { id: 'p2', first: 'Daniel', last: 'Okafor', type: 'int', user: true, title: 'Director, eDiscovery', email: 'daniel.okafor@lawfirm.example', company: '', comments: '', used: { m: 2, v: 0 } },
    { id: 'p3', first: 'Priya', last: 'Nair', type: 'int', user: true, title: 'Pod Lead', email: 'priya.nair@lawfirm.example', company: '', comments: '', used: { m: 4, v: 0 } },
    { id: 'p4', first: 'Tom', last: 'Becker', type: 'int', user: true, title: 'Data Technician', email: 'tom.becker@lawfirm.example', company: '', comments: '', used: { m: 3, v: 0 } },
    { id: 'p5', first: 'Sofia', last: 'Rossi', type: 'int', user: true, title: 'Data Scientist', email: 'sofia.rossi@lawfirm.example', company: '', comments: '', used: { m: 1, v: 0 } },
    { id: 'p6', first: 'Helen', last: 'Park', type: 'int', user: false, title: 'Partner', email: 'helen.park@lawfirm.example', company: '', comments: 'Does not use MatterFlow; receives updates by email.', used: { m: 5, v: 0 } },
    { id: 'p7', first: 'Rebecca', last: 'Stone', type: 'ext', user: false, title: 'General Counsel', email: 'rstone@acmeholdings.example', company: 'Acme Holdings', comments: 'Prefers calls before 10 AM Eastern.', used: { m: 2, v: 0 } },
    { id: 'p8', first: 'Victor', last: 'Lang', type: 'ext', user: false, title: 'Partner', email: 'vlang@hartmanpike.example', company: 'Hartman & Pike LLP', comments: '', used: { m: 1, v: 0 } },
    { id: 'p9', first: 'Laura', last: 'Whitfield', type: 'ext', user: false, title: 'Account Executive', email: 'laura.whitfield@northbridge-ediscovery.example', company: 'Northbridge eDiscovery', comments: '', used: { m: 2, v: 1 } },
    { id: 'p10', first: 'Marcus', last: 'Hale', type: 'ext', user: false, title: 'Solutions Architect', email: 'marcus.hale@northbridge-ediscovery.example', company: 'Northbridge eDiscovery', comments: '', used: { m: 1, v: 1 } },
    { id: 'p11', first: 'Anika', last: 'Patel', type: 'ext', user: false, title: 'Lead Examiner', email: 'apatel@ledgerline.example', company: 'Ledgerline Forensics', comments: '', used: { m: 1, v: 1 } },
    { id: 'p12', first: 'Jonas', last: 'Weber', type: 'ext', user: false, title: 'Delivery Manager', email: 'jonas.weber@kessler-review.example', company: 'Kessler Review Partners GmbH', comments: 'German and English.', used: { m: 0, v: 1 } },
    { id: 'p13', first: 'Kenji', last: 'Mori', type: 'ext', user: false, title: 'Account Manager', email: 'kmori@pacificdocs.example', company: 'Pacific Document Solutions', comments: '', used: { m: 0, v: 1 } },
    { id: 'p14', first: 'Elena', last: 'Petrova', type: 'ext', user: false, title: 'Principal Examiner', email: 'epetrova@deltaforensics.example', company: 'Delta Data Forensics', comments: '', used: { m: 0, v: 1 } },
    { id: 'p15', first: 'Grace', last: 'Liu', type: 'ext', user: false, title: 'Compliance Director', email: 'grace.liu@sentinel-itar.example', company: 'Sentinel ITAR Compliance', comments: '', used: { m: 0, v: 1 } },
    { id: 'p16', first: 'Owen', last: 'Brooks', type: 'ext', user: false, title: 'Engagement Lead', email: 'owen.brooks@brightpathdev.example', company: 'Brightpath Custom Dev', comments: '', used: { m: 0, v: 1 } },
  ];

  const MATTERS = [
    { id: 'm1', cm: '10482-0017', name: 'Acme Holdings v. Beta Corp', client: 'Acme Holdings' },
    { id: 'm2', cm: '20331-0004', name: 'Orion Pharma Subpoena Response', client: 'Orion Pharma' },
    { id: 'm3', cm: '31077-0002', name: 'Hartwell Merger Second Request', client: 'Hartwell Group' },
    { id: 'm4', cm: '40215-0009', name: 'Lakeview Hospital Data Breach', client: 'Lakeview Health' },
    { id: 'm5', cm: '52990-0011', name: 'Redstone Energy Arbitration', client: 'Redstone Energy' },
  ];

  /* flag: DNH = Do Not Hire, REC = Recommended */
  const VENDORS = [
    { id: 'v1', name: 'Northbridge eDiscovery', site: 'northbridge-ediscovery.example', cat: 'Preferred',
      svc: ['eDiscovery', 'Review', 'Forensic'], area: ['US', 'EU'], ai: ['Relativity aiR for Review', 'Brainspace continuous active learning'],
      note: 'Master services agreement renewed 01/2026. Volume discount above 2 TB per matter. Night and weekend processing available on request.',
      contacts: [
        { pid: 'p9', flag: 'REC', date: '03/18/2026', by: 'Maria Alvarez', note: 'Turned around the Orion productions on a weekend and caught a privilege-log gap before service. Responsive and accurate.' },
        { pid: 'p10', flag: null } ],
      links: [['m1', '02/03/2026', 'Maria Alvarez'], ['m3', '05/19/2026', 'Priya Nair'], ['m4', '08/02/2026', 'Maria Alvarez'], ['m5', '10/11/2026', 'Maria Alvarez']], updated: '10/11/2026' },
    { id: 'v2', name: 'Ledgerline Forensics', site: 'ledgerline.example', cat: 'Preferred',
      svc: ['Forensic', 'Forensic Accounting'], area: ['US', 'Canada'], ai: ['Nuix Neo anomaly detection'],
      note: 'Testifying experts available. Rates fixed through 12/2026.',
      contacts: [{ pid: 'p11', flag: 'REC', date: '06/02/2026', by: 'Daniel Okafor', note: 'Excellent deposition witness; clear and unflappable.' }],
      links: [['m1', '02/10/2026', 'Maria Alvarez'], ['m3', '05/20/2026', 'Priya Nair']], updated: '09/30/2026' },
    { id: 'v3', name: 'Kessler Review Partners GmbH', site: 'kessler-review.example', cat: 'Preferred',
      svc: ['Review', 'Translation'], area: ['EU', 'UK'], ai: ['Reveal AI classification'],
      note: 'GDPR-compliant review centre in Frankfurt. Bilingual (German, English) reviewers.',
      contacts: [{ pid: 'p12', flag: null }],
      links: [['m2', '04/14/2026', 'Priya Nair']], updated: '08/21/2026' },
    { id: 'v4', name: 'Pacific Document Solutions', site: 'pacificdocs.example', cat: 'Blacklisted',
      svc: ['eDiscovery', 'Review'], area: ['Asia Pacific'], ai: [],
      note: 'Blacklisted 09/14/2026: two missed production deadlines and media shipped unencrypted. Existing matters were transitioned out. Review before any new engagement.',
      contacts: [{ pid: 'p13', flag: 'DNH', date: '09/14/2026', by: 'Daniel Okafor', note: 'Shipped unencrypted media for the Redstone arbitration and did not self-report. Do not hire.' }],
      links: [['m5', '03/02/2026', 'Maria Alvarez']], updated: '09/14/2026' },
    { id: 'v5', name: 'Sentinel ITAR Compliance', site: 'sentinel-itar.example', cat: 'Preferred',
      svc: ['ITAR', 'Forensic', 'Managed Services'], area: ['US'], ai: [],
      note: 'US persons only. Facility is ITAR registered; certificate on file with Legal Operations.',
      contacts: [{ pid: 'p15', flag: null }],
      links: [['m2', '04/20/2026', 'Priya Nair']], updated: '07/08/2026' },
    { id: 'v6', name: 'Brightpath Custom Dev', site: 'brightpathdev.example', cat: 'Preferred',
      svc: ['Custom Development'], area: ['US', 'EU'], ai: ['Azure OpenAI (GPT-4 class) for summarisation'],
      note: 'Builds connectors and one-off ingestion scripts. No matters yet.',
      contacts: [{ pid: 'p16', flag: null }], links: [], updated: '10/29/2026' },
    { id: 'v7', name: 'Orbis Legal Staffing', site: 'orbislegal.example', cat: 'Preferred',
      svc: ['Review', 'Managed Services'], area: ['US'], ai: [],
      note: 'Contract review attorneys, minimum 2 week engagement.',
      contacts: [], links: [['m4', '08/05/2026', 'Maria Alvarez']], updated: '08/05/2026' },
    { id: 'v8', name: 'Delta Data Forensics', site: 'deltaforensics.example', cat: 'Blacklisted',
      svc: ['Forensic'], area: ['US'], ai: [],
      note: 'Blacklisted 10/02/2026 after a chain-of-custody gap on a hospital imaging job. Client complaint on file.',
      contacts: [{ pid: 'p14', flag: 'DNH', date: '10/02/2026', by: 'Priya Nair', note: 'Chain-of-custody form was incomplete for 3 of 11 devices. Client escalated.' }],
      links: [['m1', '03/09/2026', 'Maria Alvarez'], ['m4', '07/21/2026', 'Maria Alvarez']], updated: '10/02/2026' },
    { id: 'v9', name: 'Meridian Translation Group', site: 'meridiantranslation.example', cat: 'Preferred',
      svc: ['Translation', 'Review'], area: ['EU', 'Asia Pacific', 'Middle East'], ai: ['DeepL Pro API', 'In-house machine translation QA model'],
      note: '40+ languages. Certified translations for court filings in 5 working days.',
      contacts: [], links: [], updated: '06/17/2026' },
    { id: 'v10', name: 'Harbor Analytics', site: 'harboranalytics.example', cat: 'Preferred',
      svc: ['eDiscovery', 'Custom Development'], area: ['US', 'Canada'], ai: ['Azure OpenAI (GPT-4 class)', 'Relativity aiR for Review'],
      note: 'Analytics and technology-assisted review. Data stays in the firm tenant.',
      contacts: [], links: [['m2', '04/16/2026', 'Sofia Rossi']], updated: '09/03/2026' },
  ];

  /* Matter 1 team (Matter > Team). */
  const TEAM = [
    { pid: 'p1', title: 'Case Manager' }, { pid: 'p6', title: 'Lead Attorney' }, { pid: 'p4', title: 'Technical Lead' },
    { pid: 'p7', title: 'Client Contact' }, { pid: 'p8', title: 'Opposing Counsel' },
  ];

  /* Roles x permissions (proposal). Existing role names from the app. i = implied by another ticked permission. */
  const ROLES = ['System Admin', 'Director', 'Project Manager', 'Pod Lead', 'Data Technician', 'Data Scientist', 'SME Intake Coordinator'];
  const PERMS = [
    { group: 'Vendors', code: 'Vendor.View', short: 'See vendors and the matter Vendors tab', desc: 'See the Vendors page, vendor details, and the Vendors tab on a matter', roles: [1, 1, 1, 1, 0, 0, 0] },
    { group: 'Vendors', code: 'Vendor.Manage', short: 'Create, edit and delete vendors and contacts', desc: 'Create, edit and delete vendors; add and edit their contacts and contact notes; maintain the Services and Areas lists', roles: [1, 1, 0, 0, 0, 0, 0] },
    { group: 'Vendors', code: 'Vendor.Link', short: 'Link and unlink vendors on a matter', desc: 'Link and unlink vendors on a matter (Add Vendor). Needs Vendor.View and Matter.View', roles: [1, 1, 1, 0, 0, 0, 0] },
    { group: 'People', code: 'People.View', short: 'See the People page', desc: 'See the People page. Pickers on the Team tab and vendor contacts work for anyone who may edit them', roles: [1, 1, 1, 1, 0, 0, 1] },
    { group: 'People', code: 'People.Manage', short: 'Create, edit and delete people', desc: 'Create, edit and delete people, including the quick "Add New Person" in pickers', roles: [1, 1, 1, 0, 0, 0, 0] },
  ];

  /* Personas for the mockup (who is looking). */
  const PERSONAS = {
    full:  { label: 'Vendor manager (all vendor and people rights)', view: 1, manage: 1, link: 1, pview: 1, pmanage: 1, name: 'Daniel Okafor', ini: 'DO' },
    pm:    { label: 'Project Manager (view and link, no manage)', view: 1, manage: 0, link: 1, pview: 1, pmanage: 1, name: 'Maria Alvarez', ini: 'MA' },
    ro:    { label: 'Read only (Vendor.View only)', view: 1, manage: 0, link: 0, pview: 1, pmanage: 0, name: 'Priya Nair', ini: 'PN' },
    none:  { label: 'No vendor rights at all', view: 0, manage: 0, link: 0, pview: 0, pmanage: 0, name: 'Tom Becker', ini: 'TB' },
  };

  const byId = (arr, id) => arr.find((x) => x.id === id);
  return { TODAY, SERVICES, AREAS, TEAM_TITLES, PEOPLE, MATTERS, VENDORS, TEAM, ROLES, PERMS, PERSONAS,
    person: (id) => byId(PEOPLE, id), vendor: (id) => byId(VENDORS, id), matter: (id) => byId(MATTERS, id) };
})();
