import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Permission } from '../../../core/auth/permissions';
import { settle } from '../../../shared/testing/org-testing';
import { aCheck, aTask, allowed, mountTaskPage, q, transition } from './task-detail-testing';
import { TaskDetailStore } from './task-detail.store';

const PERMS: Permission[] = ['Task.View', 'Task.Edit', 'Workflow.Execute'];
const STATUS_BUTTON = '[data-facts] [data-status] [data-inline-trigger]';

describe('Focus after a status action (K3, #328)', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function mount(status = 'IN_PROGRESS') {
    const task = aTask({
      status,
      statusLabel: status,
      allowedActions: allowed({
        transitions: [
          transition('HOLD'),
          transition('RESUME'),
          transition('REOPEN'),
          transition('COMPLETE'),
          transition('CANCEL'),
        ],
      }),
    });
    const m = await mountTaskPage(task, PERMS, {
      tasks: {
        getTaskCompletionCheck: () => of(aCheck({ isReady: true })),
      } as never,
    });
    // Something else has focus, as it has after a header button or a dialog goes away.
    (document.activeElement as HTMLElement | null)?.blur();
    return { ...m, store: m.fixture.debugElement.injector.get(TaskDetailStore) };
  }

  const focused = () => document.activeElement as HTMLElement | null;

  it('Resume (no dialog) puts focus on the Status menu button', async () => {
    const { fixture, el, store } = await mount('ON_HOLD');
    await store.requestAction('RESUME');
    await settle(fixture);
    expect(q(el, STATUS_BUTTON)).not.toBeNull();
    expect(focused()).toBe(q(el, STATUS_BUTTON));
  });

  it('Put on hold and Cancel task (reason dialog) put focus on the Status menu button', async () => {
    for (const action of ['HOLD', 'CANCEL'] as const) {
      const { fixture, el, store } = await mount();
      store.dialog.set({ kind: 'reason', action });
      await store.submitReason(action, 'Because');
      await settle(fixture);
      expect(focused(), action).toBe(q(el, STATUS_BUTTON));
      TestBed.resetTestingModule();
    }
  });

  it('Reopen task and Complete task (straight through, or after the bulk dialog) put focus on the Status menu button', async () => {
    const reopen = await mount('COMPLETED');
    reopen.store.dialog.set({ kind: 'reopen' });
    await reopen.store.confirmReopen();
    await settle(reopen.fixture);
    expect(focused()).toBe(q(reopen.el, STATUS_BUTTON));
    TestBed.resetTestingModule();

    const complete = await mount();
    await complete.store.beginComplete();
    await settle(complete.fixture);
    expect(focused()).toBe(q(complete.el, STATUS_BUTTON));
    TestBed.resetTestingModule();

    const bulk = await mount();
    bulk.store.dialog.set({ kind: 'complete', check: aCheck({ isReady: false }) });
    await bulk.store.confirmBulkComplete();
    await settle(bulk.fixture);
    expect(focused()).toBe(q(bulk.el, STATUS_BUTTON));
  });

  it('a failed or cancelled action moves nothing', async () => {
    const { fixture, store } = await mount();
    const before = focused();
    store.dialog.set({ kind: 'reason', action: 'CANCEL' });
    store.closeDialog();
    await settle(fixture);
    expect(focused()).toBe(before);
    expect(store.statusFocus()).toBe(0);
  });

  it('without a Status menu (a person who may not change the status) the page heading takes the focus', async () => {
    const task = aTask({ allowedActions: allowed({ transitions: [] }) });
    const { fixture, el } = await mountTaskPage(task, PERMS);
    const store = fixture.debugElement.injector.get(TaskDetailStore);
    expect(q(el, STATUS_BUTTON)).toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    store.statusFocus.update((n) => n + 1);
    await settle(fixture);
    expect(focused()).toBe(q(el, '[data-page-title]'));
  });
});
