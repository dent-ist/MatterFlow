import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

let nextId = 0;

/** `Request Details (Search and Culling, Form 1)`: the task type and the form version the request was made on (a heading: Title Case, D-20). */
export function requestHeadingText(
  task: { taskType?: { name?: string } | null; formVersionNo?: number | null } | null,
): string {
  const parts = [
    task?.taskType?.name,
    task?.formVersionNo != null ? `Form ${task.formVersionNo}` : null,
  ];
  return `Request Details (${parts.filter(Boolean).join(', ')})`;
}

/**
 * The collapsible "Request Details" section (#313), shared by the Details panel (read view) and the Edit dialog: a heading whose text button
 * (`mf-btn--text`, D-13: it acts) opens and closes the body, with the form's field count and the chevron at the right; the heading text starts at the same left edge as
 * the other sub-headings of its container. The body is hidden, not removed, so a form inside keeps its values
 * and still validates while it is closed. The owner decides whether it starts open (`open`) and remembers the choice (`openChange`
 * fires for the person's own toggle only).
 */
@Component({
  selector: 'mf-request-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="rs__h">
      <button
        type="button"
        class="mf-btn mf-btn--text rs__toggle"
        data-request-toggle
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="bodyId"
        (click)="open.set(!open())"
      >
        <span class="rs__text">{{ heading() }}</span>
        <span class="rs__count" data-request-count>{{ countText() }}</span>
        <i
          class="pi"
          [class.pi-chevron-down]="open()"
          [class.pi-chevron-right]="!open()"
          aria-hidden="true"
        ></i>
      </button>
    </h3>
    <div class="rs__body" [id]="bodyId" data-request-body [hidden]="!open()">
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .rs__h {
      margin: 0;
      padding-bottom: var(--mf-s1);
      border-bottom: 1px solid var(--mf-border-soft);
      font-size: var(--mf-fs-md);
    }
    /* The look is the shared text button; only its layout is here: the whole line, left aligned, wrapping, with its text on the panel's left edge. */
    .rs__toggle {
      display: flex;
      justify-content: flex-start;
      gap: var(--mf-s2);
      width: calc(100% + var(--mf-s2));
      margin-left: calc(-1 * var(--mf-s2));
      text-align: left;
      white-space: normal;
    }
    .rs__text {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .rs__count {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 400;
    }
    .rs__body {
      min-width: 0;
      margin-top: var(--mf-s3);
    }
    .rs__body[hidden] {
      display: none;
    }
  `,
})
export class RequestSection {
  /** For example `Request Details (Search and Culling, Form 1)`. */
  readonly heading = input.required<string>();
  /** How many fields the form has. */
  readonly count = input.required<number>();
  readonly open = model(false);

  protected readonly bodyId = `rs-body-${nextId++}`;
  protected readonly countText = computed(
    () => `${this.count()} ${this.count() === 1 ? 'field' : 'fields'}`,
  );
}
