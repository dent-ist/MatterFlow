import { Injectable, signal } from '@angular/core';

/** Whether the shortcut list is open. The list itself (a PrimeNG dialog, `shortcut-help.ts`) loads the first time it is asked for. */
@Injectable({ providedIn: 'root' })
export class ShortcutHelpState {
  readonly open = signal(false);
}
