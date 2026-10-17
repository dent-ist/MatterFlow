import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CoverageTaskType } from '../../../api/generated/api-client';
import { NOTE_HINT, coverageNotes, noneNoteText, oneNoteText } from './coverage-model';

/**
 * The two statements above both Coverage orientations (C3, #136): task types nobody handled in the period (informational: neutral, collapsed,
 * with the hint to try a longer period) and task types handled by only one person (a warning: amber with an icon, in a status region, shown only
 * above zero). Type names only, never people; no "gap" or "bus factor" wording. Both follow the scope and period of the board.
 */
@Component({
  selector: 'mf-coverage-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notes" data-coverage-notes>
      @if (notes().none.length) {
        <details class="note note--info" data-note="none">
          <summary>{{ noneText() }}</summary>
          <p class="hint">{{ hint }}</p>
          <ul class="tnames" aria-label="Task types with no completed tasks">
            @for (t of notes().none; track t.taskTypeId) {
              <li>{{ t.name }}</li>
            }
          </ul>
        </details>
      }
      <div role="status" data-note-region>
        @if (notes().one.length) {
          <p class="note note--warn" data-note="one">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>{{ oneText() }}</span>
          </p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .notes {
      display: grid;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
    }
    .notes:empty,
    .notes > [role='status']:empty {
      display: none;
    }
    .note {
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .note--info {
      color: var(--mf-text);
      background: var(--mf-surface);
    }
    .note--info summary {
      cursor: pointer;
    }
    .note--info .hint {
      margin: var(--mf-s2) 0 var(--mf-s1);
      color: var(--mf-text-muted);
    }
    .tnames {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .note--warn {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border-color: var(--mf-warning);
      font-weight: 600;
    }
  `,
})
export class CoverageNotes {
  readonly types = input.required<readonly CoverageTaskType[]>();

  protected readonly hint = NOTE_HINT;
  protected readonly notes = computed(() => coverageNotes(this.types()));
  protected readonly noneText = computed(() => noneNoteText(this.notes().none.length));
  protected readonly oneText = computed(() => oneNoteText(this.notes().one.map((t) => t.name)));
}
