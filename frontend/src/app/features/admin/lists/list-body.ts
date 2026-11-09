import { InjectionToken } from '@angular/core';

/**
 * What the shared list editor (`mf-list-editor`) asks of the body of a list (the grid with its dialogs). A body provides itself under this token
 * (`providers: [{ provide: LIST_BODY, useExisting: forwardRef(() => MyListPage) }]`), so the editor reaches it without importing it (the bodies
 * load lazily, one per list).
 */
export interface ListBody {
  /** Opens the New dialog: the editor's primary button calls it. Absent for a list that cannot be created (Status Labels). */
  openNew?(): void;
  /** True while a New, Rename or Edit dialog is open with edited text (the leave guard asks, D-31). */
  hasUnsavedChanges(): boolean;
}

export const LIST_BODY = new InjectionToken<ListBody>('LIST_BODY');
