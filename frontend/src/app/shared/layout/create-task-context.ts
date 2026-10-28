import { Injectable, signal } from '@angular/core';

/**
 * The matter a page wants "Create task" in the shell bar to start with (issue #904, epic #893). My Matters sets it while the person manages exactly one
 * matter, so that page needs no create button of its own and the shell button opens Create task with that matter filled in. A page sets it when it
 * shows and clears it when it goes away; nothing is remembered. Create task still lets the person choose another matter.
 */
@Injectable({ providedIn: 'root' })
export class CreateTaskContext {
  /** The matter to start with, or null (Create task then opens blank, as everywhere else). */
  readonly matterId = signal<number | null>(null);
}
