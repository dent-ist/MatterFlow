import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
  unsavedChangesGuard,
} from './unsaved-changes.guard';

describe('unsavedChangesGuard', () => {
  const run = (component: HasUnsavedChanges) =>
    TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(
        component,
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot,
      ),
    );

  it('lets a clean page go without asking', () => {
    expect(run({ hasUnsavedChanges: () => false })).toBe(true);
    expect(TestBed.inject(LeaveConfirmService).open()).toBe(false);
  });

  it('asks Stay / Leave of a dirty page that cannot save for leaving', async () => {
    const leave = TestBed.inject(LeaveConfirmService);
    const answer = run({ hasUnsavedChanges: () => true }) as Promise<boolean>;
    expect(leave.open()).toBe(true);
    expect(leave.saveOffer()).toBeNull();
    leave.answer(false);
    expect(await answer).toBe(false);
    expect(leave.open()).toBe(false);
  });

  describe('a page that can save for leaving (VP8, #398)', () => {
    const page = (saved: Promise<boolean>) => ({
      hasUnsavedChanges: () => true,
      saveForLeaveLabel: 'Save draft and leave',
      saveForLeave: vi.fn().mockReturnValue(saved),
    });

    it('offers the save with its label; saving then leaving resolves the guard with true', async () => {
      const leave = TestBed.inject(LeaveConfirmService);
      const component = page(Promise.resolve(true));
      const answer = run(component) as Promise<boolean>;
      expect(leave.saveOffer()?.label).toBe('Save draft and leave');
      await leave.saveAndLeave();
      expect(component.saveForLeave).toHaveBeenCalledOnce();
      expect(await answer).toBe(true);
      expect(leave.open()).toBe(false);
      expect(leave.saveOffer()).toBeNull();
    });

    it('a failed save keeps the person on the page (the guard resolves false)', async () => {
      const leave = TestBed.inject(LeaveConfirmService);
      const answer = run(page(Promise.resolve(false))) as Promise<boolean>;
      await leave.saveAndLeave();
      expect(await answer).toBe(false);
      expect(leave.saving()).toBe(false);
    });

    it('a save that throws also keeps the person on the page', async () => {
      const leave = TestBed.inject(LeaveConfirmService);
      const answer = run(page(Promise.reject(new Error('boom')))) as Promise<boolean>;
      await leave.saveAndLeave();
      expect(await answer).toBe(false);
    });

    it('Leave and Stay still work beside the save, and a second press while saving is ignored', async () => {
      const leave = TestBed.inject(LeaveConfirmService);
      let finish!: (v: boolean) => void;
      const slow = new Promise<boolean>((r) => (finish = r));
      const component = page(slow);
      const answer = run(component) as Promise<boolean>;
      const first = leave.saveAndLeave();
      expect(leave.saving()).toBe(true);
      void leave.saveAndLeave();
      expect(component.saveForLeave).toHaveBeenCalledOnce();
      finish(true);
      await first;
      expect(await answer).toBe(true);

      const again = run(page(Promise.resolve(true))) as Promise<boolean>;
      leave.answer(true);
      expect(await again).toBe(true);
    });
  });
});
