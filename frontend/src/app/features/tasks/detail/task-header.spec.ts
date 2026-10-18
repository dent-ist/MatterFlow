import { TestBed } from '@angular/core/testing';
import { Permission } from '../../../core/auth/permissions';
import { aStep, aTask, allowed, click, mountTaskPage, q, transition } from './task-detail-testing';

const PERMS: Permission[] = ['Task.View', 'Task.Edit', 'Workflow.Execute'];
const LONG_TITLE = 'T'.repeat(200);
const LONG_MATTER = 'M'.repeat(205);

const actionIds = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-page-actions] button[data-action]')).map(
    (b) => b.dataset['action']!,
  );

async function overflow(
  fixture: Awaited<ReturnType<typeof mountTaskPage>>['fixture'],
  el: HTMLElement,
): Promise<string[]> {
  await click(fixture, q(el, '[data-overflow]'));
  return Array.from(el.querySelectorAll<HTMLElement>('[role=menuitem]')).map(
    (i) => i.dataset['action']!,
  );
}

describe('Task header (#296 to #299): shared record header, context line, sensitive note', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is the record header: one h1 "TSK-n title", the crumb ends at the task number, no section icon but the type icon', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    const h1 = el.querySelectorAll('h1');
    expect(h1.length).toBe(1);
    expect(q(el, '[data-record-header][data-kind="task"]')).not.toBeNull();
    expect(h1[0].textContent).toContain('TSK-1042');
    expect(h1[0].textContent).toContain('Process Smith custodians');
    expect(q(el, '[data-task-header] [data-ref]')!.textContent).toBe('TSK-1042');
    expect(q(el, 'h1 [data-title-icon]')).not.toBeNull();
    expect(q(el, 'h1 [data-page-icon]')).toBeNull();
    expect(q(el, '[data-crumb-current]')!.getAttribute('aria-current')).toBe('page');
    // The old page header and its slots are gone.
    expect(q(el, 'mf-page-header')).toBeNull();
    // A task has no Active badge.
    expect(q(el, 'h1 mf-active-badge')).toBeNull();
  });

  it('keeps a 200-character title whole in the document with the full text as tooltip, and cuts a 205-character matter crumb at 40 with its full text', async () => {
    const task = aTask({ title: LONG_TITLE });
    const { el } = await mountTaskPage({ ...task, matter: { ...task.matter, name: LONG_MATTER } }, [
      ...PERMS,
      'Matter.View',
    ]);
    expect(q(el, '[data-task-header] [data-name]')!.textContent).toBe(LONG_TITLE);
    expect(q(el, '[data-task-header] [data-name]')!.getAttribute('title')).toBe(LONG_TITLE);
    expect(q(el, 'h1')!.textContent).toContain(LONG_TITLE);
    const crumb = q(el, 'nav[aria-label="Breadcrumb"] a[href*="/matters/"]')!;
    expect(crumb.getAttribute('title')).toBe(`00343-00012 ${LONG_MATTER}`);
    expect(crumb.querySelector('[aria-hidden=true]')!.textContent!.length).toBe(40);
    expect(crumb.querySelector('.mf-sr-only')!.textContent).toBe(`00343-00012 ${LONG_MATTER}`);
  });

  it('puts Matter, Client, Task type and Workflow in ONE muted context line, each once, links only with the view permissions', async () => {
    const full = await mountTaskPage(aTask(), [...PERMS, 'Matter.View', 'Client.View']);
    const ctx = q(full.el, '[data-record-context]')!;
    expect(ctx.textContent).toContain('Merger Review');
    expect(ctx.textContent).toContain('00343');
    expect(ctx.textContent).toContain('Data Processing');
    expect(ctx.textContent).toContain('Standard Processing v2 (ordered)');
    expect(ctx.querySelector('a[href="/matters/7"]')).not.toBeNull();
    expect(ctx.querySelector('a[href="/clients/1"]')).not.toBeNull();
    expect(q(full.el, '[data-matter] mf-copy-button button')).toBeNull();
    expect(q(full.el, '[data-context]')!.getAttribute('title')).toBe(
      '00343-00012 Merger Review'.replace(/^/, 'Matter ') +
        ' · Client 00343 · Data Processing · Standard Processing v2 (ordered)',
    );
    // Each fact once on the whole page.
    const text = full.el.textContent!;
    for (const once of ['Data Processing', 'Standard Processing', 'Pod A']) {
      expect(text.split(once).length - 1, once).toBe(1);
    }
    TestBed.resetTestingModule();

    const plain = await mountTaskPage(aTask(), PERMS);
    const ctx2 = q(plain.el, '[data-record-context]')!;
    expect(ctx2.querySelector('a')).toBeNull();
    expect(ctx2.textContent).toContain('00343');
    expect(ctx2.textContent).toContain('Merger Review');
  });

  it('shows the Sensitive note of the record header once (a single role=note line), not the old banner', async () => {
    const task = aTask();
    const { el } = await mountTaskPage(
      { ...task, matter: { ...task.matter, isSensitive: true } },
      PERMS,
    );
    const notes = el.querySelectorAll('[data-sensitive-banner]');
    expect(notes.length).toBe(1);
    expect(notes[0].getAttribute('role')).toBe('note');
    expect(notes[0].classList).toContain('rh__note');
    expect(notes[0].textContent).toContain('Sensitive matter.');
    expect(q(el, 'mf-sensitive-badge')).not.toBeNull();
    expect(q(el, '.pg-banner[data-sensitive-banner]')).toBeNull();
  });
});

describe('Task header actions (#298)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('open task: Edit, Activity and the primary Complete task in the header; the overflow has Put on hold, Copy link and Cancel task last, set apart', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), PERMS);
    expect(actionIds(el)).toEqual(['edit', 'activity', 'complete']);
    const complete = q(el, '[data-action="complete"]')!;
    expect(complete.classList).toContain('mf-btn--primary');
    expect(complete.textContent).toContain('Complete task');
    expect(await overflow(fixture, el)).toEqual(['hold', 'copy-link', 'cancel']);
    const cancel = q(el, '[role=menuitem][data-action="cancel"]')!;
    expect(cancel.classList).toContain('am__item--danger');
    expect(cancel.classList).toContain('am__item--sep');
    // The Workflow section and the banners no longer have action buttons.
    expect(q(el, '[data-workflow-tab] [data-complete-task-button]')).toBeNull();
  });

  it('on hold: Resume in the overflow, no primary button (Resume is not a second primary)', async () => {
    const task = aTask({
      status: 'ON_HOLD',
      statusLabel: 'On Hold',
      allowedActions: allowed({ transitions: [transition('RESUME'), transition('CANCEL')] }),
    });
    const { fixture, el } = await mountTaskPage(task, PERMS);
    expect(actionIds(el)).toEqual(['edit', 'activity']);
    expect(await overflow(fixture, el)).toEqual(['resume', 'copy-link', 'cancel']);
  });

  it('closed task: Reopen task is the primary; no Complete; Cancel is not offered when the lifecycle does not allow it', async () => {
    const task = aTask({
      status: 'CANCELLED',
      statusLabel: 'Cancelled',
      allowedActions: allowed({ canEdit: false, transitions: [transition('REOPEN')] }),
    });
    const { fixture, el } = await mountTaskPage(task, PERMS);
    expect(actionIds(el)).toEqual(['activity', 'reopen']);
    expect(q(el, '[data-action="reopen"]')!.classList).toContain('mf-btn--primary');
    expect(await overflow(fixture, el)).toEqual(['copy-link']);
  });

  it('Complete task carries the readiness hint as tooltip and description, and opens the dialog', async () => {
    const task = aTask({
      workflow: {
        steps: [
          aStep({
            stepInstanceId: 102,
            sequenceNo: 2,
            title: 'Deduplicate',
            requiredInputsSatisfied: false,
          }),
        ],
      } as never,
    });
    const { fixture, el, fakes } = await mountTaskPage(task, PERMS);
    const button = q(el, '[data-action="complete"]')!;
    expect(button.getAttribute('title')).toBe('1 step needs information');
    expect(el.querySelector(`#${button.getAttribute('aria-describedby')}`)!.textContent).toBe(
      '1 step needs information',
    );
    await click(fixture, button);
    expect(fakes.tasks['getTaskCompletionCheck']).toHaveBeenCalled();
  });

  it('permissions: a transition without permission leaves out its item; a person who can change nothing has Activity and Copy link only', async () => {
    const none = aTask({
      allowedActions: allowed({
        canEdit: false,
        transitions: [
          transition('HOLD', { permitted: false, blockedReason: 'PERMISSION_DENIED' }),
          transition('COMPLETE', { permitted: false, blockedReason: 'PERMISSION_DENIED' }),
          transition('CANCEL', { permitted: false, blockedReason: 'PERMISSION_DENIED' }),
        ],
      }),
    });
    const { fixture, el } = await mountTaskPage(none, ['Task.View']);
    expect(actionIds(el)).toEqual(['activity']);
    expect(await overflow(fixture, el)).toEqual(['copy-link']);
    expect(q(el, '[data-view-only]')).not.toBeNull();
  });

  it('a Matter that blocks the action shows it disabled with the reason', async () => {
    const task = aTask({
      allowedActions: allowed({
        transitions: [
          transition('COMPLETE', { permitted: false, blockedReason: 'MATTER_INACTIVE' }),
        ],
      }),
    });
    const { el } = await mountTaskPage(task, PERMS);
    const button = q(el, '[data-action="complete"]')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe(
      "The matter is inactive, so this task can't be completed.",
    );
  });

  it('Copy link puts the task address on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, el } = await mountTaskPage(aTask(), PERMS);
    await overflow(fixture, el);
    await click(fixture, q(el, '[role=menuitem][data-action="copy-link"]'));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/tasks/1042`);
  });
});

describe('Task facts strip (#297)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const tiles = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('.mf-facts__tile .mf-facts__label')).map((l) => l.textContent!);

  it('has exactly six tiles in the order Status, Priority, Due, Assignee, Pod, Workflow', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Task.SetPriority', 'Task.Assign']);
    expect(tiles(el)).toEqual(['Status', 'Priority', 'Due', 'Assignee', 'Pod', 'Workflow']);
    expect(q(el, '[data-facts]')!.getAttribute('aria-label')).toBe('Task facts');
    expect(q(el, '[data-progress]')!.textContent!.trim()).toBe('1 of 3 resolved');
    expect(q(el, '[data-pod]')!.textContent).toContain('Pod A');
    expect(q(el, '[data-due]')!.textContent).toContain('ASAP');
  });

  it('keeps the inline menus and their accessible names in the tiles', async () => {
    const { el } = await mountTaskPage(aTask(), [...PERMS, 'Task.SetPriority', 'Task.Assign']);
    for (const tile of ['status', 'priority', 'assignee']) {
      expect(q(el, `[data-${tile}] [data-inline-trigger]`), tile).not.toBeNull();
    }
    expect(q(el, '[data-status] [data-inline-trigger]')!.getAttribute('aria-label')).toBe(
      'In Progress, change status of TSK-1042',
    );
  });

  it('shows an en dash with "No pod" for screen readers, and Unassigned, when there is no Pod or assignee', async () => {
    const { el } = await mountTaskPage(aTask({ assignedPod: undefined, assignedUser: undefined }), [
      'Task.View',
    ]);
    expect(q(el, '[data-pod] .mf-facts__value')!.textContent).toContain('–');
    expect(q(el, '[data-pod] .mf-sr-only')!.textContent).toBe('No pod');
    expect(q(el, '[data-assignee]')!.textContent).toContain('Unassigned');
  });

  it('names a workflow without steps as No steps and has no progress number', async () => {
    const { el } = await mountTaskPage(aTask({ workflow: { steps: [] } as never }), PERMS);
    expect(q(el, '[data-progress]')!.textContent!.trim()).toBe('No steps');
  });

  it('keeps Type, Pod and Due out of the Details panel (once on the page)', async () => {
    const { el } = await mountTaskPage(aTask(), PERMS);
    const panel = q(el, '[data-section="details"]')!.textContent!;
    expect(panel).not.toContain('Task type');
    expect(panel).not.toContain('Pod A');
    expect(panel).not.toContain('Due');
    expect(panel).toContain('Project');
    expect(panel).toContain('Created');
  });
});
