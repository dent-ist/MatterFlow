import { Injectable, inject, signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

/** Implemented by screens that can hold edits the user has not saved (UX: unsaved-changes guard). */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
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

  ask(): Promise<boolean> {
    this.resolver?.(false);
    this.open.set(true);
    return new Promise<boolean>((resolve) => (this.resolver = resolve));
  }

  answer(leave: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.open.set(false);
    resolve?.(leave);
  }
}

/** Route leave guard: asks before navigating away from a dirty screen. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  component.hasUnsavedChanges() ? inject(LeaveConfirmService).ask() : true;
