import {
  DIALOG_COPY,
  dialogCopy,
  DialogCopy,
  impactLine,
  listNames,
  publishCopy,
  retireCopy,
} from './dialog-copy';

describe('dialog wording table (#362)', () => {
  const all: [string, DialogCopy][] = [
    ...Object.entries(DIALOG_COPY),
    ['publish', publishCopy(3)],
    ['retire', retireCopy(2)],
  ];

  it('puts the verb in the primary button and says what is kept in the cancel', () => {
    expect(DIALOG_COPY.deactivateTaskType).toEqual({
      title: 'Deactivate task type?',
      confirm: 'Deactivate task type',
      cancel: 'Keep active',
      danger: true,
    });
    expect(DIALOG_COPY.deactivateWorkflow.confirm).toBe('Deactivate workflow');
    expect(DIALOG_COPY.deactivateStep.confirm).toBe('Deactivate step');
    expect(DIALOG_COPY.discardDraft.confirm).toBe('Discard draft');
    expect(DIALOG_COPY.discardChanges.cancel).toBe('Keep editing');
    expect(publishCopy(3)).toEqual({
      title: 'Publish v3',
      confirm: 'Publish v3',
      cancel: 'Back to draft',
      danger: false,
    });
    expect(retireCopy(2)).toEqual({
      title: 'Retire v2?',
      confirm: 'Retire v2',
      cancel: 'Keep published',
      danger: true,
    });
  });

  it('uses one vocabulary: records are deactivated, published versions retired, drafts discarded', () => {
    for (const [key, copy] of all) {
      if (key.startsWith('deactivate')) expect(copy.confirm).toMatch(/^Deactivate /);
      if (key === 'retire') expect(copy.confirm).toMatch(/^Retire v/);
      if (key === 'discardDraft') expect(copy.confirm).toMatch(/^Discard draft/);
      expect(copy.confirm).not.toMatch(/delete|remove|archive/i);
    }
  });

  it('is red only for the destructive dialogs', () => {
    const danger = all.filter(([, c]) => c.danger).map(([k]) => k);
    expect(danger.sort()).toEqual(
      [
        'deactivateStep',
        'deactivateTaskType',
        'deactivateWorkflow',
        'discardChanges',
        'discardDraft',
        'retire',
      ].sort(),
    );
  });
});

describe('impactLine (#362)', () => {
  it('says nothing for a count the API did not return, and never prints a made-up zero', () => {
    for (const kind of ['deactivateTaskType', 'deactivateWorkflow', 'deactivateStep'] as const) {
      expect(impactLine(kind, {})).toEqual({ text: '', names: [] });
      expect(impactLine(kind, { openTasks: null, drafts: null, names: null }).text).toBe('');
    }
    expect(impactLine('retireVersion', { versionNo: 2 }).text).toBe('New tasks cannot use it.');
    expect(impactLine('publishVersion', { versionNo: 2, newVersionNo: 3 }).text).toBe(
      'Tasks already running keep v2. New tasks use v3.',
    );
  });

  it('reads a known zero as an answer', () => {
    expect(impactLine('deactivateTaskType', { openTasks: 0 }).text).toBe(
      'No open tasks use this task type.',
    );
    expect(impactLine('deactivateStep', { drafts: 0 }).text).toBe(
      'No workflow draft contains this step.',
    );
  });

  it('uses the singular for one and the plural for many', () => {
    expect(impactLine('deactivateTaskType', { openTasks: 1 }).text).toBe(
      '1 open task keeps this type.',
    );
    expect(impactLine('deactivateTaskType', { openTasks: 14 }).text).toBe(
      '14 open tasks keep this type.',
    );
    expect(impactLine('deactivateStep', { drafts: 1 }).text).toBe(
      '1 workflow draft contains this step; it keeps it.',
    );
    expect(impactLine('deactivateStep', { drafts: 3 }).text).toBe(
      '3 workflow drafts contain this step; they keep it.',
    );
    expect(impactLine('deactivateStep', { drafts: 2, publishedVersions: 1 }).text).toBe(
      '2 workflow drafts contain this step; they keep it. 1 published workflow version uses it and is not changed.',
    );
    expect(impactLine('deactivateStep', { drafts: 0, publishedVersions: 3 }).text).toBe(
      'No workflow draft contains this step. 3 published workflow versions use it and are not changed.',
    );
    expect(impactLine('deactivateStep', { drafts: 0, publishedVersions: 0 }).text).toBe(
      'No workflow draft contains this step. No published workflow version uses it.',
    );
    // A number the API did not return is left out, never shown as 0.
    expect(impactLine('deactivateStep', { drafts: null, publishedVersions: undefined }).text).toBe(
      '',
    );
  });

  it('names the task types that lose a workflow and the workflows left without a task type', () => {
    const wf = impactLine('deactivateWorkflow', { names: ['Discovery'], openTasks: 2 });
    expect(wf.text).toBe('1 task type loses this workflow. 2 open tasks keep running on it.');
    expect(wf.names).toEqual(['Discovery']);
    const tt = impactLine('deactivateTaskType', { names: ['A', 'B'], openTasks: 5 });
    expect(tt.text).toBe('5 open tasks keep this type. 2 workflows are left without a task type.');
    expect(tt.names).toEqual(['A', 'B']);
  });

  it('says what happens to running tasks when a version is retired or published', () => {
    expect(impactLine('retireVersion', { versionNo: 2, openTasks: 14 }).text).toBe(
      '14 open tasks keep running on v2. New tasks cannot use it.',
    );
    expect(
      impactLine('publishVersion', { versionNo: 2, newVersionNo: 3, openTasks: 14 }).text,
    ).toBe('Tasks already running keep v2 (14 open). New tasks use v3.');
  });

  it('names the task types that have no other published workflow when a version is retired', () => {
    expect(impactLine('retireVersion', { versionNo: 2, names: ['Billing request 02'] }).text).toBe(
      'Billing request 02 has no other published workflow. New tasks cannot use it.',
    );
    expect(
      impactLine('retireVersion', { versionNo: 2, names: ['A', 'B'], openTasks: 3 }).text,
    ).toBe(
      'A and B have no other published workflow. 3 open tasks keep running on v2. New tasks cannot use it.',
    );
    const many = impactLine('retireVersion', {
      versionNo: 2,
      names: ['Billing request 02', 'B', 'C', 'D'],
      openTasks: 14,
    });
    expect(many.text).toBe(
      'Billing request 02 and 3 other task types have no other published workflow. 14 open tasks keep running on v2. New tasks cannot use it.',
    );
    expect(many.names).toEqual([]);
  });

  it('says what the first publication does: no running tasks to keep, task types become usable', () => {
    expect(impactLine('publishVersion', { firstVersion: true, usableTaskTypes: 3 }).text).toBe(
      'New tasks use this version. This makes 3 task types usable.',
    );
    expect(impactLine('publishVersion', { firstVersion: true, usableTaskTypes: 1 }).text).toBe(
      'New tasks use this version. This makes 1 task type usable.',
    );
    // A count the API did not return is left out, and so is a zero.
    expect(impactLine('publishVersion', { firstVersion: true, usableTaskTypes: null }).text).toBe(
      'New tasks use this version.',
    );
    expect(impactLine('publishVersion', { firstVersion: true, usableTaskTypes: 0 }).text).toBe(
      'New tasks use this version.',
    );
  });
});

describe('listNames (#379)', () => {
  it('lists up to three names and then "and n others"', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A and B');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(listNames(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 other');
    expect(listNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 others');
  });
});

describe('admin kit dialogs (#542)', () => {
  const kit = {
    deactivateAssetType: dialogCopy.deactivateAssetType({ assets: 12 }),
    deactivatePriority: dialogCopy.deactivatePriority({ openTasks: 31 }),
    deactivateLinkRole: dialogCopy.deactivateLinkRole({ links: 14 }),
    deleteUnusedPriority: dialogCopy.deleteUnusedPriority({ openTasks: 0 }),
    deleteUnusedLinkRole: dialogCopy.deleteUnusedLinkRole({ links: 0 }),
    setDefaultPriority: dialogCopy.setDefaultPriority({ name: 'Normal', previousName: 'High' }),
    renameStatusLabel: dialogCopy.renameStatusLabel({ code: 'IN_PROGRESS' }),
  };

  it('gives every entry a title, a body, a confirm and a cancel label', () => {
    for (const [key, c] of Object.entries(kit)) {
      expect(c.title, key).toBeTruthy();
      expect(c.body, key).toBeTruthy();
      expect(c.confirm, key).toBeTruthy();
      expect(c.cancel, key).toBeTruthy();
      // The safe button is the cancel one: it says what is kept, or just cancels the form.
      expect(c.cancel, key).toMatch(/^(Keep |Cancel$)/);
    }
  });

  it('says what stays for a deactivation, with the number the API returned', () => {
    expect(kit.deactivateAssetType.body).toBe(
      "12 assets keep this type. It won't be offered for new assets. You can activate it again.",
    );
    expect(kit.deactivatePriority.body).toBe(
      "31 open tasks keep this priority. It won't be offered for new or changed tasks. You can activate it again.",
    );
    expect(kit.deactivateLinkRole.body).toBe(
      "14 links keep this role. It won't be offered for new links. You can activate it again.",
    );
    expect(dialogCopy.deactivateAssetType({ assets: 1 }).body).toMatch(/^1 asset keeps this type/);
    expect(dialogCopy.deactivatePriority({ openTasks: 1 }).body).toMatch(
      /^1 open task keeps this priority/,
    );
    expect(dialogCopy.deactivateLinkRole({ links: 1 }).body).toMatch(/^1 link keeps this role/);
    expect(dialogCopy.deactivatePriority({ openTasks: 0 }).body).toMatch(
      /^No open task uses this priority/,
    );
  });

  it('drops the sentence of a number the API did not return, and never prints a made-up 0', () => {
    expect(dialogCopy.deactivateAssetType().body).toBe(
      "It won't be offered for new assets. You can activate it again.",
    );
    expect(dialogCopy.deactivatePriority({ openTasks: null }).body).toBe(
      "It won't be offered for new or changed tasks. You can activate it again.",
    );
    expect(dialogCopy.deactivateLinkRole({ links: undefined }).body).toBe(
      "It won't be offered for new links. You can activate it again.",
    );
    expect(impactLine('deactivatePriority', {}).text).not.toMatch(/\b0\b/);
  });

  it('allows Delete only for the two unused-delete dialogs, and Deactivate everywhere else', () => {
    for (const [key, c] of Object.entries(kit)) {
      if (key.startsWith('deleteUnused')) {
        expect(c.confirm, key).toMatch(/^Delete (priority|link role)$/);
        expect(c.danger, key).toBe(true);
      } else {
        expect(c.confirm, key).not.toMatch(/delete|remove|archive/i);
      }
      if (key.startsWith('deactivate')) {
        expect(c.confirm, key).toMatch(/^Deactivate /);
        expect(c.danger, key).toBe(true);
      }
    }
    expect(kit.deleteUnusedPriority.body).toBe(
      "No task uses this priority. Deleting it can't be undone.",
    );
    expect(kit.deleteUnusedLinkRole.body).toBe(
      "No link uses this role. Deleting it can't be undone.",
    );
    // Asked for a used record anyway, the dialog says why it cannot and points to Deactivate.
    expect(dialogCopy.deleteUnusedPriority({ openTasks: 3 }).body).toBe(
      "3 open tasks use this priority, so it can't be deleted. Deactivate it instead.",
    );
    expect(dialogCopy.deleteUnusedLinkRole({ links: 1 }).body).toBe(
      "1 link uses this role, so it can't be deleted. Deactivate it instead.",
    );
  });

  it('sets the default with one calm sentence, and renames a status label without touching its code', () => {
    expect(kit.setDefaultPriority.title).toBe('Make Normal the default priority?');
    expect(kit.setDefaultPriority.body).toBe(
      'Normal is the default priority. New tasks start with it. High stays available.',
    );
    expect(kit.setDefaultPriority.danger).toBe(false);
    expect(dialogCopy.setDefaultPriority().body).toBe('New tasks start with it.');
    expect(kit.renameStatusLabel.body).toBe(
      "Only the name changes. The code IN_PROGRESS and every task's status stay as they are.",
    );
    expect(dialogCopy.renameStatusLabel().body).toBe(
      "Only the name changes. Every task's status stays as it is.",
    );
    expect(kit.renameStatusLabel.danger).toBe(false);
  });
});
