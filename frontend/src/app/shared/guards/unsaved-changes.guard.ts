import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

/** Implemented by screens that can hold edits the user has not saved (UX: unsaved-changes guard). */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave without saving?';

/** Route leave guard: asks before navigating away from a dirty screen. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) return true;
  return inject(DOCUMENT).defaultView?.confirm(UNSAVED_CHANGES_MESSAGE) ?? true;
};
