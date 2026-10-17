// Names and sentences used for the demo data.

export const FIRST_NAMES = [
  'Avery',
  'Jordan',
  'Priya',
  'Mateo',
  'Hannah',
  'Liam',
  'Sofia',
  'Noah',
  'Elena',
  'Ravi',
  'Grace',
  'Omar',
  'Chloe',
  'Daniel',
  'Mei',
  'Lucas',
];
export const LAST_NAMES = [
  'Morgan',
  'Nair',
  'Okafor',
  'Lindqvist',
  'Alvarez',
  'Chen',
  'Haddad',
  'Brennan',
  'Kowalski',
  'Tanaka',
  'Moreau',
  'Patel',
  'Sullivan',
  'Rossi',
];

export const CLIENT_NAMES = [
  'Northwind Holdings',
  'Contoso Energy',
  'Fabrikam Logistics',
  'Tailspin Aerospace',
  'Litware Health',
];
export const MATTER_NAMES = [
  'Smith v. Acme',
  'Internal investigation 2026',
  'Regulatory inquiry',
  'Merger second request',
  'Patent dispute',
  'Employment class action',
  'Supply contract arbitration',
  'Data breach response',
  'Securities litigation',
  'Product liability',
  'Antitrust subpoena',
  'Insurance coverage dispute',
];
export const PROJECT_NAMES = [
  'Custodian wave 1',
  'Second request production',
  'Privilege review',
  'Rolling productions',
];

export const COMMENTS = [
  'Picked this up, starting with the intake checks.',
  'Waiting on the custodian list from the case team, will continue tomorrow.',
  'Counts reconcile with the vendor report.',
  'Please confirm the date range before we process.',
  'Raised the exception report with the attorney, no blocker for now.',
  'Looks good on my side, ready for QC.',
  'Client asked to move this up, bumping the priority.',
  'Handing over to the next shift with notes in the steps.',
  'Re-ran the job after the tool update, no more errors.',
  'Need the password for the encrypted media, asked the requestor.',
];
export const HOLD_REASONS = [
  'Waiting for the custodian list from the case team',
  'Client has not released the media yet',
  'Blocked by the matter team, scope under review',
  'Waiting for a workspace slot in the Relativity environment',
  'Paused until the attorney confirms the search terms',
];
export const CANCEL_REASONS = [
  'Requested by mistake, duplicate of another task',
  'Matter team withdrew the request',
  'Superseded by a newer request',
  'Client changed the scope, new task to follow',
  'Cancelled by the requestor',
];
export const SKIP_COMMENTS = [
  'Not needed for this request.',
  'Handled earlier in a previous task.',
];
export const DESCRIPTION_LINES = [
  'Please handle this request for the matter team.',
  'Details are in the request form below. Ping me if anything is unclear.',
  'Rush request from the case team, see the due date.',
  'Routine request, no special handling needed.',
  'Follow-up to last week’s request; same custodians and date range.',
];

export const TEXT_BY_KEY = [
  [/email/, () => 'requestor@example.test'],
  [/url|link/, (n) => `https://example.test/demo/${n}`],
  [/hash/, () => 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  [/bates_prefix/, () => 'DEMO'],
  [/bates|volume|set|name|label|id/, (n) => `DEMO-${String(n).padStart(6, '0')}`],
  [/path|location|server/, (n) => `\\\\fileshare\\demo\\batch${n}`],
  [
    /party|to|from|recipient|vendor|provider|producing|by|holder|carrier|contact/,
    () => 'Contoso Litigation Support',
  ],
  [/tool/, () => 'Nuix'],
  [
    /notes?|detail|summary|explanation|instructions|reason/,
    () => 'Demo data: nothing unusual to report.',
  ],
];
