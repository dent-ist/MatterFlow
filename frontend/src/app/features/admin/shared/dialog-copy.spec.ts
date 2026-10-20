import { DIALOG_COPY, DialogCopy, impactLine, publishCopy, retireCopy } from './dialog-copy';

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
