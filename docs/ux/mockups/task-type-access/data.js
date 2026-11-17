/* Task Type access mockup (#1402, epic #1397): invented data only. No real person, client, matter or role assignment exists here.
   "Today" is fixed so the screens read the same on every day: Tuesday 11/17/2026, 09:30 AM. */
(function () {
  const TODAY = new Date(2026, 10, 17, 9, 30);
  const pad = (n) => String(n).padStart(2, '0');
  /* D-60: a date in a cell is MM/DD (the year only when it is not this year); a time is hh:mm AM/PM. */
  const md = (m, d) => pad(m) + '/' + pad(d);
  const time = (h, mi) => pad(h % 12 || 12) + ':' + pad(mi) + ' ' + (h >= 12 ? 'PM' : 'AM');

  /* Roles (dbo.Role). members = active people who hold it. System Admin is never offered: it sees everything (owner rule). */
  const ROLES = [
    { id: 1, name: 'Attorney', members: 38, active: true },
    { id: 2, name: 'Billing', members: 6, active: true },
    { id: 3, name: 'Contract Reviewer', members: 0, active: false },
    { id: 4, name: 'eDiscovery Analyst', members: 11, active: true },
    { id: 5, name: 'Operations Admin', members: 3, active: true },
    { id: 6, name: 'Paralegal', members: 22, active: true },
    { id: 7, name: 'Partner', members: 12, active: true },
    { id: 8, name: 'Project Manager', members: 9, active: true },
    { id: 9, name: 'Records Clerk', members: 0, active: true },
    { id: 10, name: 'Vendor Liaison', members: 4, active: true },
  ];
  /* People who can open tasks at all (an active user with Task.View through an active role): the preview counts "people" over this group. */
  const PEOPLE = 86;

  /* The person who is signed in. The first one holds only the Operations Admin role (so can lock themselves out); System Admin never can. */
  const VIEWERS = {
    manager: { name: 'Priya Raman', roles: [5], sysAdmin: false },
    sysadmin: { name: 'Priya Raman', roles: [], sysAdmin: true },
  };

  /* Task types. access: lists of role ids; view empty = open to everyone. icon is a PrimeIcons name, colour a --mf-tt-* key. */
  const TYPES = [
    { id: 1, name: 'Document Collection', icon: 'folder-open', colour: 'blue', wf: 'Collection Intake', wfMore: 1, target: 5, form: 'Published', formV: 'v3', workflows: 3, open: 41, active: true, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 2, name: 'Data Processing', icon: 'cog', colour: 'teal', wf: 'Standard Processing', wfMore: 0, target: 3, form: 'Published', formV: 'v2', workflows: 2, open: 27, active: true, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 3, name: 'Privilege Review', icon: 'shield', colour: 'violet', wf: 'Two-Pass Review', wfMore: 1, target: 10, form: 'Published', formV: 'v4', workflows: 2, open: 14, active: true, usable: true, hideAssigned: 3, desc: 'Attorney review of documents withheld or redacted for privilege.', access: { view: [1, 4, 7], edit: [1, 7], assign: [1, 4] } },
    { id: 4, name: 'Legal Hold Notice', icon: 'megaphone', colour: 'amber', wf: 'Hold Notice and Tracking', wfMore: 0, target: 2, form: 'Published', formV: 'v1', workflows: 1, open: 9, active: true, usable: true, hideAssigned: 2, access: { view: [1, 6, 7, 8, 9], edit: [1, 6], assign: [] } },
    { id: 5, name: 'Production Request', icon: 'send', colour: 'indigo', wf: 'Production Workflow', wfMore: 1, target: 7, form: 'Published', formV: 'v2', workflows: 2, open: 18, active: true, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 6, name: 'Vendor Invoice Approval', icon: 'dollar', colour: 'green', wf: 'Invoice Approval', wfMore: 0, target: 5, form: 'Published', formV: 'v1', workflows: 1, open: 6, active: true, usable: true, hideAssigned: 1, access: { view: [2, 7, 10], edit: [2], assign: [2] } },
    { id: 7, name: 'Custodian Interview', icon: 'comments', colour: 'rose', wf: 'Interview Scheduling', wfMore: 0, target: 4, form: 'Published', formV: 'v2', workflows: 1, open: 12, active: true, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 8, name: 'Early Case Assessment', icon: 'chart-line', colour: 'orange', wf: 'Assessment Workflow', wfMore: 1, target: 8, form: 'Draft', formV: 'v2', workflows: 2, open: 5, active: true, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 9, name: 'QC Review', icon: 'check-square', colour: 'slate', wf: 'Quality Control', wfMore: 1, target: 3, form: 'Published', formV: 'v5', workflows: 2, open: 22, active: true, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 10, name: 'Contract Analysis', icon: 'file-edit', colour: 'blue', wf: 'Contract Review', wfMore: 0, target: 6, form: 'Published', formV: 'v1', workflows: 1, open: 4, active: true, usable: true, hideAssigned: 0, access: { view: [3], edit: [], assign: [] } },
    { id: 11, name: 'Search Term Report', icon: 'search', colour: 'teal', wf: 'No workflow', wfMore: 0, target: null, form: 'No form', formV: '', workflows: 0, open: 0, active: true, usable: false, access: { view: [], edit: [], assign: [] } },
    { id: 12, name: 'Legacy Review Export', icon: 'download', colour: 'slate', wf: 'Export Batch', wfMore: 0, target: 14, form: 'Published', formV: 'v1', workflows: 1, open: 0, active: false, usable: true, access: { view: [], edit: [], assign: [] } },
    { id: 13, name: 'Cost Estimate', icon: 'calculator', colour: 'amber', wf: 'Estimate Approval', wfMore: 0, target: 2, form: 'Published', formV: 'v2', workflows: 1, open: 0, active: false, usable: true, access: { view: [], edit: [], assign: [] } },
  ];

  /* Audit events (newest first). The text is exactly what TaskTypeAccessService writes (section 8.2 of docs/ux/task-type-access/README.md). */
  const AUDIT = [
    { day: 'Today', when: time(9, 12), who: 'Priya Raman', code: 'TASK_TYPE_ACCESS_CHANGED', obj: 'Privilege Review', op: 'a',
      text: "Task Type 'Privilege Review': Can View changed from (everyone) to Attorney, eDiscovery Analyst, Partner; Can Edit changed from (no extra limit) to Attorney, Partner; Can Be Assigned changed from (no extra limit) to Attorney, eDiscovery Analyst" },
    { day: 'Today', when: time(9, 12), who: 'Priya Raman', code: 'TASK_TYPE_RESTRICTED', obj: 'Privilege Review', op: 'a', text: "Task Type 'Privilege Review' is now restricted to the roles in Can View" },
    { day: 'Yesterday', when: time(16, 41), who: 'Marcus Oyelaran', code: 'TASK_TYPE_ACCESS_CHANGED', obj: 'Vendor Invoice Approval', op: 'b',
      text: "Task Type 'Vendor Invoice Approval': Can Edit changed from Billing, Partner to Billing" },
    { day: 'Thursday, 11/12', when: time(11, 5), who: 'Amelia Hartwell', code: 'TASK_TYPE_ACCESS_CHANGED', obj: 'Cost Estimate', op: 'c',
      text: "Task Type 'Cost Estimate': Can View changed from Billing, Partner, Project Manager to (everyone); Can Edit changed from Billing to (no extra limit)" },
    { day: 'Thursday, 11/12', when: time(11, 5), who: 'Amelia Hartwell', code: 'TASK_TYPE_UNRESTRICTED', obj: 'Cost Estimate', op: 'c', text: "Task Type 'Cost Estimate' is now visible to everyone" },
    { day: 'Wednesday, 11/11', when: time(2, 18), who: 'Priya Raman', code: 'TASK_TYPE_WORKFLOWS_CHANGED', obj: 'Production Request', op: 'd', text: "Task Type 'Production Request': workflows changed" },
  ];
  /* The labels the audit page will show (audit-format.ts EVENT_TYPES) for the three new codes, and the code of an existing event for comparison. */
  const EVENT_LABELS = {
    TASK_TYPE_ACCESS_CHANGED: 'Task type access changed',
    TASK_TYPE_RESTRICTED: 'Task type restricted',
    TASK_TYPE_UNRESTRICTED: 'Task type opened to everyone',
    TASK_TYPE_WORKFLOWS_CHANGED: 'Task type workflows changed',
  };

  /* Roles screen rows (Administration > Users > Roles). */
  const ROLE_ROWS = [
    { id: 1, name: 'Attorney', desc: 'Reviews and signs off legal work.', landing: 'My Matters', perms: 22 },
    { id: 2, name: 'Billing', desc: 'Approves vendor invoices and cost estimates.', landing: 'Automatic', perms: 9 },
    { id: 4, name: 'eDiscovery Analyst', desc: 'Runs searches, processing and productions.', landing: 'My Work', perms: 18 },
    { id: 6, name: 'Paralegal', desc: 'Prepares, tracks and QCs work for attorneys.', landing: 'My Work', perms: 16 },
    { id: 7, name: 'Partner', desc: 'Oversees matters and approves production.', landing: 'Dashboard', perms: 26 },
    { id: 8, name: 'Project Manager', desc: 'Plans matters and assigns work.', landing: 'Dashboard', perms: 24 },
    { id: 9, name: 'Records Clerk', desc: 'Keeps hold notices and custodian records.', landing: 'Automatic', perms: 7 },
  ];

  window.D = { TODAY, ROLES, PEOPLE, VIEWERS, TYPES, AUDIT, EVENT_LABELS, ROLE_ROWS, md, time };
})();
