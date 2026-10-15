import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TaskTypeIconLibrary } from './task-type-icon-library';

export type TaskTypeIconSize = 'sm' | 'md' | 'lg';

/** Used when a key is unknown (a library that no longer has it) or missing. */
export const DEFAULT_TASK_TYPE_ICON = 'file-text';

/**
 * The one Task Type icon (`mf-task-type-icon`). Decorative: `aria-hidden`, the Task Type name is always shown next to it. Drawn in the
 * surrounding text colour (`currentColor`), never in a per-type colour. Sizes: sm 16px, md 20px, lg 28px. The markup comes from our own
 * generated, validated data (plain shapes only), so it is trusted here.
 */
@Component({
  selector: 'mf-task-type-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    [attr.data-icon]="iconKey() || null"
    [innerHTML]="markup()"
  ></svg>`,
  host: { '[attr.data-size]': 'size()' },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 1.25rem;
      height: 1.25rem;
      color: inherit;
      vertical-align: middle;
    }
    :host([data-size='sm']) {
      width: 1rem;
      height: 1rem;
    }
    :host([data-size='lg']) {
      width: 1.75rem;
      height: 1.75rem;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class TaskTypeIcon {
  private readonly library = inject(TaskTypeIconLibrary);
  private readonly sanitizer = inject(DomSanitizer);

  /** The Task Type's icon key. */
  readonly iconKey = input<string | null | undefined>(DEFAULT_TASK_TYPE_ICON);
  readonly size = input<TaskTypeIconSize>('md');

  protected readonly markup = computed(() => {
    const paths = this.library.paths();
    if (!paths) return '';
    const inner = paths[this.iconKey() ?? ''] ?? paths[DEFAULT_TASK_TYPE_ICON] ?? '';
    return this.sanitizer.bypassSecurityTrustHtml(inner);
  });

  constructor() {
    void this.library.ensurePaths();
  }
}
