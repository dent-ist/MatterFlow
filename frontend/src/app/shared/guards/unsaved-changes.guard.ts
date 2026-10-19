import { Injectable, inject, signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

/** Implemented by screens that can hold edits the user has not saved (UX: unsaved-changes guard). */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
  /**
   * Optional: saves the edits so the person can leave without losing them. The leave question then offers `saveForLeaveLabel` as the
   * primary choice; it resolves to false when saving failed, and the person stays on the page (which shows why).
   */
  saveForLeave?(): Promise<boolean>;
  /** The label of that choice, for example "Save draft and leave". */
  readonly saveForLeaveLabel?: string;
}

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * Asks "Leave without saving?" in the themed confirm dialog (`mf-leave-confirm-host` in the app shell renders it). One question at a
 * time; asking again while one is open declines the earlier one.
 */
@Injectable({ providedIn: 'root' })
export class LeaveConfirmService {
  private resolver: ((leave: boolean) => void) | null = null;

  /** True while the question is on screen. */
  readonly open = signal(false);
  /** The primary "save and leave" choice of the question on screen (label and what it runs), or null for the plain Stay / Leave. */
  readonly saveOffer = signal<{ label: string; run: () => Promise<boolean> } | null>(null);
  /** True while "save and leave" is saving. */
  readonly saving = signal(false);

  ask(save: { label: string; run: () => Promise<boolean> } | null = null): Promise<boolean> {
    this.resolver?.(false);
    this.saveOffer.set(save);
    this.saving.set(false);
    this.open.set(true);
    return new Promise<boolean>((resolve) => (this.resolver = resolve));
  }

  answer(leave: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.open.set(false);
    this.saveOffer.set(null);
    resolve?.(leave);
  }

  /** "Save and leave": saves, then leaves; if saving fails the person stays (the page shows what went wrong). */
  async saveAndLeave(): Promise<void> {
    const offer = this.saveOffer();
    if (!offer || this.saving()) return;
    this.saving.set(true);
    let saved = false;
    try {
      saved = await offer.run();
    } catch {
      saved = false;
    } finally {
      this.saving.set(false);
    }
    this.answer(saved);
  }
}

/** Route leave guard: asks before navigating away from a dirty screen. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  component.hasUnsavedChanges()
    ? inject(LeaveConfirmService).ask(
        component.saveForLeave
          ? {
              label: component.saveForLeaveLabel ?? 'Save and leave',
              run: () => component.saveForLeave!(),
            }
          : null,
      )
    : true;
