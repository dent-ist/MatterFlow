/* Notes round 2 mockup (#1406, epic #1405): invented data only. Matter: Hartwell Industries, "Brightline Subpoena Response", CM Number 00343-00012. "Today" is 11/18/2026. */
window.D = (function () {
  const people = {
    PR: 'Priya Raman', DO: 'Daniel Okafor', ML: 'Mei Lin Chen', TB: 'Tomas Berg', HF: 'Hannah Frost',
  };
  const TAGS = {
    privilege: { name: 'Privilege', tone: 'rose' },
    custodian: { name: 'Custodian', tone: 'blue' },
    terms: { name: 'Search Terms', tone: 'violet' },
    deadline: { name: 'Deadline', tone: 'amber' },
    vendor: { name: 'Vendor', tone: 'teal' },
    action: { name: 'Action Item', tone: 'orange' },
  };
  /* id, parent, name. Order = display order (alphabetical per level is done by the renderer). */
  const FOLDERS = [
    [1, 0, 'Privilege Review'], [2, 1, 'Privilege Log'], [3, 1, 'Clawback Agreements'],
    [4, 0, 'Custodians'], [5, 4, 'Executive Team'], [6, 4, 'Finance'], [7, 4, 'IT and Records'],
    [8, 0, 'Search Terms and Validation'], [9, 8, 'Round 1 Terms'], [10, 8, 'Round 2 Terms'],
    [11, 0, 'Vendor Communications'], [12, 0, 'Meet and Confer'],
    [13, 0, 'Productions'], [14, 13, 'Volume 001'], [15, 13, 'Volume 002'],
    [16, 0, 'QC Notes'],
  ];
  /* folder, title, preview, tags, flags (p pinned, l locked), author, updated */
  const N = (folder, title, pv, tags, flags, by, at) => ({ folder, title, pv, tags: tags || [], p: /p/.test(flags || ''), l: /l/.test(flags || ''), by, at });
  const NOTES = [
    N(1, 'Privilege review protocol, second pass', 'Reviewers tag attorney-client, work product and common-interest separately. Anything touching the Brightline merger goes to Priya first.', ['privilege'], 'pl', 'PR', '11/12 09:40 AM'),
    N(1, 'Questions for the privilege call on Friday', 'Do we log in-house paralegal emails? Confirm whether the 2019 board deck is withheld in full or redacted.', ['privilege', 'action'], '', 'DO', '11/17 04:05 PM'),
    N(2, 'Privilege log columns agreed with opposing counsel', 'Control number, date, author, recipients, privilege basis, description. No separate column for attachments.', ['privilege'], 'p', 'PR', '11/16 11:20 AM'),
    N(2, 'Log batch 3: 214 entries, 9 open questions', 'Open questions are listed at the bottom. Hannah is checking the 2018 legal department aliases.', ['privilege', 'deadline'], '', 'HF', '11/17 02:48 PM'),
    N(2, 'Log batch 2 QC findings', 'Eleven descriptions were too generic ("email re legal advice"). Reworded and re-exported.', ['privilege'], '', 'ML', '11/10 03:15 PM'),
    N(3, 'Clawback agreement: draft 502(d) language', 'Order language circulated to Brightline counsel on 11/09. Waiting for their redline.', ['privilege', 'deadline'], '', 'PR', '11/09 05:02 PM'),
    N(4, 'Custodian list: who owns which source', 'One page index of all 31 custodians with data source, hold date and collection owner.', ['custodian'], 'p', 'DO', '11/15 10:12 AM'),
    N(5, 'Custodian interview: R. Alvarez (CFO)', 'Uses a personal tablet for board materials. Texts with the CEO are on a company phone. Two shared drives named.', ['custodian', 'privilege'], 'p', 'DO', '11/17 03:30 PM'),
    N(5, 'M. Chen mobile device collection status', 'Imaging scheduled Thursday 9:00 AM. Passcode is held by IT; the device is a company iPhone.', ['custodian', 'action'], '', 'ML', '11/17 01:10 PM'),
    N(5, 'Executive assistants: mailbox delegates to add', 'Three assistants have delegate access to executive mailboxes. Add them as custodians before the second hold notice.', ['custodian', 'action'], '', 'DO', '11/14 04:44 PM'),
    N(5, 'Board minutes 2019 to 2021: scope question', 'Ask the Hartwell GC whether minutes before March 2019 are in scope for Request 14.', ['custodian'], '', 'PR', '11/11 09:05 AM'),
    N(6, 'Finance: bank statement request log', 'Statements for the two Brightline accounts requested from treasury on 11/08. Follow up on 11/20.', ['custodian', 'deadline'], '', 'HF', '11/16 08:55 AM'),
    N(6, 'Finance share drive: retention schedule', 'Drive purges after 24 months. Hold applied by IT on 10/30.', ['custodian'], 'l', 'TB', '11/04 02:20 PM'),
    N(7, 'IT: backup tape inventory', 'Eleven tapes from 2018. Vendor says restore takes about five days per tape.', ['vendor'], '', 'TB', '11/13 10:40 AM'),
    N(7, 'IT: Slack retention is 90 days', 'Exports for the three project channels were pulled on 11/03. Older messages are gone.', ['custodian'], '', 'ML', '11/05 01:00 PM'),
    N(7, 'IT: departed employee mailboxes', 'Four mailboxes were archived to cold storage after exit. Restore request submitted.', ['custodian', 'action'], '', 'DO', '11/12 03:50 PM'),
    N(8, 'Search term negotiation: status', 'Round 1 returned 41,000 hits. Round 2 trims the proximity operators and adds three code names.', ['terms'], 'p', 'PR', '11/17 05:10 PM'),
    N(9, 'Round 1 terms and hit counts', 'Full list with hits by custodian. Terms 4, 11 and 17 account for most of the volume.', ['terms'], '', 'ML', '11/06 11:45 AM'),
    N(9, 'Round 1: false positive review sample', 'Sample of 400 documents. Estimated precision 38 percent before proximity limits.', ['terms'], '', 'HF', '11/07 09:30 AM'),
    N(9, 'Round 1 terms sent to opposing counsel', 'Sent 11/02. They asked for the hit report by custodian, which we declined for now.', ['terms', 'deadline'], 'l', 'PR', '11/02 06:12 PM'),
    N(10, 'Round 2 terms: proposed list', 'Adds the project code names "Harbor" and "Lantern". Drops terms 4 and 17.', ['terms'], '', 'ML', '11/16 04:30 PM'),
    N(10, 'Round 2: validation sample plan', 'Random sample from the null set, 1,500 documents, two reviewers, agree on a stopping rule.', ['terms', 'action'], '', 'DO', '11/15 02:05 PM'),
    N(10, 'Round 2: agreed operators', 'Proximity within 15 words. Wildcards only at the end of a stem.', ['terms'], '', 'PR', '11/14 10:00 AM'),
    N(11, 'Vendor kickoff call notes', 'Processing starts after the second hold notice. Vendor needs the custodian index and date ranges.', ['vendor'], '', 'TB', '11/03 03:00 PM'),
    N(11, 'Vendor: processing exceptions list', 'Fourteen password protected files. Passwords requested from custodians.', ['vendor', 'action'], '', 'ML', '11/17 11:15 AM'),
    N(11, 'Vendor: hosting cost estimate', 'Estimated 1.8 TB after processing. Monthly hosting quote attached to the asset record.', ['vendor'], '', 'HF', '11/12 01:25 PM'),
    N(11, 'Vendor: TAR workflow proposal', 'Continuous active learning with weekly validation. Needs sign-off before the first batch.', ['vendor', 'deadline'], '', 'DO', '11/16 09:45 AM'),
    N(11, 'Vendor: chain of custody form', 'Form signed for the three laptops and the two phones.', ['vendor'], 'l', 'TB', '11/04 05:30 PM'),
    N(12, 'Meet and confer 11/12: summary', 'Agreed on custodians 1 to 24. Opposing counsel will respond on Slack data by 11/22.', ['deadline'], 'p', 'PR', '11/12 06:20 PM'),
    N(12, 'Meet and confer: talking points for 11/19', 'Lead with the Slack retention gap, then the backup tapes cost-shifting position.', ['action'], '', 'PR', '11/18 08:40 AM'),
    N(12, 'Opposing counsel contact sheet', 'Names, roles, direct dials and who copies whom on correspondence.', [], '', 'HF', '10/29 10:15 AM'),
    N(12, 'Court order: ESI protocol entered 10/28', 'Key dates: rolling productions start 12/01, privilege logs due 14 days after each volume.', ['deadline'], 'l', 'PR', '10/29 09:00 AM'),
    N(13, 'Production schedule and Bates ranges', 'Volume 001 HART-0000001 to HART-0048220. Volume 002 starts at 0048221.', ['deadline'], '', 'ML', '11/17 09:20 AM'),
    N(14, 'Volume 001: load file spec', 'DAT with the agreed fields, OPT with page-level images, natives for spreadsheets.', [], '', 'ML', '11/13 02:15 PM'),
    N(14, 'Volume 001: QC checklist', 'Bates continuity, redaction burn-in, slip sheets, field mapping, and load file test.', ['action'], '', 'HF', '11/16 03:10 PM'),
    N(16, 'QC: redaction spot check', 'Twenty documents per reviewer. Two missed account numbers; both were fixed.', [], '', 'HF', '11/16 01:50 PM'),
    N(16, 'QC: coding consistency report', 'Inconsistency rate 3.1 percent. Re-review of the near-duplicate groups scheduled.', [], '', 'ML', '11/11 11:00 AM'),
    N(0, 'Matter kickoff: scope and contacts', 'Subpoena served 09/22 on Hartwell. Response due in rolling volumes starting 12/01.', ['deadline'], 'p', 'PR', '09/24 10:30 AM'),
    N(0, 'Hold notice: first wave distributed', 'Notice sent 09/26 to 31 custodians. Acknowledgements tracked in the Team tab.', ['custodian'], '', 'DO', '09/26 04:00 PM'),
    N(0, 'Budget assumptions for the response', 'Review hours, hosting and vendor fees. Revisit after round 2 of search terms.', [], '', 'PR', '10/05 01:40 PM'),
    N(0, 'Glossary of project code names', 'Harbor, Lantern, Cedar, Falcon. Code names appear in about a third of internal emails.', ['terms'], '', 'ML', '10/14 09:55 AM'),
    N(0, 'Open questions for the client GC', 'Retention exceptions, personal devices, and who signs the production certification.', ['action'], '', 'PR', '11/17 06:00 PM'),
    N(0, 'Parking lot', 'Ideas to revisit once Volume 001 is out: TAR validation, privilege log automation.', [], '', 'DO', '11/01 04:10 PM'),
  ];
  const ME = { name: 'Priya Raman', ini: 'PR' };
  return { people, TAGS, FOLDERS, NOTES, ME, matter: { cm: '00343-00012', name: 'Brightline Subpoena Response', client: 'Hartwell Industries' } };
})();
