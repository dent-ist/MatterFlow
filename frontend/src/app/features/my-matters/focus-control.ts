import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TaskTypeBadge } from '../../shared/task-type/task-type-badge';
import { MyMattersFocus } from './focus';
import { SectionTypes, TypeOption } from './section-types';

/** The text of the Focus chip: "Focus: Intake, Production" (a type the list does not know shows by its number). */
export function focusLabel(ids: readonly number[], options: readonly TypeOption[]): string {
  const names = ids.map((id) => options.find((o) => o.id === id)?.name ?? `Task type ${id}`);
  return `Focus: ${names.join(', ')}`;
}

/**
 * The Focus button of My Matters (PM v2, PV-07 #858) and, once a Focus is set, its chip. "Focus" opens a checklist of the task types with Save and
 * Clear; the choice is kept per person and stays until it is changed (`MyMattersFocus`). The chip names the types and has a remove button that
 * clears the Focus everywhere. A native `details`, so the keyboard and screen readers get the disclosure for free; Escape closes it and returns to the button.
 */
@Component({
  selector: 'mf-mm-focus',
  imports: [TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'close()' },
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .fc__summary {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      cursor: pointer;
      list-style: none;
    }
    .fc__summary::-webkit-details-marker {
      display: none;
    }
    .fc__panel {
      position: absolute;
      z-index: 30;
      top: calc(100% + 2px);
      right: 0;
      width: min(22rem, 86vw);
      box-sizing: border-box;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2, 0 4px 14px rgb(0 0 0 / 0.18));
    }
    .fc__hint {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .fc__list {
      max-height: 14rem;
      margin: 0 0 var(--mf-s2);
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .fc__opt {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      min-height: 32px;
      cursor: pointer;
    }
    .fc__actions {
      display: flex;
      gap: var(--mf-s2);
    }
    @media (max-width: 639.98px) {
      .fc__summary,
      .fc__opt,
      .fc__actions .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    <details #details (toggle)="opened($event)" data-focus>
      <summary class="fc__summary" data-focus-trigger>
        <i class="pi pi-bullseye" aria-hidden="true"></i>
        <span>Focus</span>
        @if (focus.types().length > 0) {
          <span class="mf-sr-only">, {{ focus.types().length }} task types set</span>
        }
      </summary>
      <div class="fc__panel" role="group" aria-label="Focus task types">
        <p class="fc__hint">
          Pick the task types you work on now. Every list on this page shows only these, until you
          change it.
        </p>
        @if (options.options().length === 0) {
          <p class="fc__hint" data-focus-none>No task types to choose from.</p>
        } @else {
          <ul class="fc__list">
            @for (o of options.options(); track o.id) {
              <li>
                <label class="fc__opt">
                  <input
                    type="checkbox"
                    [checked]="draft().includes(o.id)"
                    (change)="toggle(o.id)"
                    [attr.data-focus-option]="o.id"
                  />
                  <mf-task-type-badge
                    [decorative]="true"
                    [iconKey]="o.iconKey"
                    [colourKey]="o.colourKey"
                    [name]="o.name"
                  />
                  <span>{{ o.name }}</span>
                </label>
              </li>
            }
          </ul>
        }
        <div class="fc__actions">
          <button type="button" class="mf-btn mf-btn--primary" data-focus-save (click)="save()">
            Save
          </button>
          <button type="button" class="mf-btn" data-focus-clear (click)="clearAll()">Clear</button>
        </div>
      </div>
    </details>
  `,
})
export class FocusControl {
  protected readonly focus = inject(MyMattersFocus);
  protected readonly options = inject(SectionTypes);
  private readonly details = viewChild<ElementRef<HTMLDetailsElement>>('details');
  protected readonly draft = signal<number[]>([]);

  constructor() {
    this.options.ensure();
    this.focus.ensure();
  }

  /** Opening starts from the saved Focus, so a closed-without-saving panel never keeps a half choice. */
  protected opened(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) this.draft.set([...this.focus.types()]);
  }

  protected toggle(id: number): void {
    const now = this.draft();
    this.draft.set(now.includes(id) ? now.filter((t) => t !== id) : [...now, id]);
  }

  protected save(): void {
    this.focus.set(this.draft());
    this.close();
  }

  protected clearAll(): void {
    this.focus.clear();
    this.draft.set([]);
    this.close();
  }

  protected close(): void {
    const details = this.details()?.nativeElement;
    if (!details?.open) return;
    details.open = false;
    details.querySelector<HTMLElement>('summary')?.focus();
  }
}

/** The chip under the filters: "Focus: Intake, Production" with a button that clears the Focus for every section. */
@Component({
  selector: 'mf-mm-focus-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s2);
    }
    :host(:empty) {
      display: none;
    }
    .fc__chip {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .fc__x {
      min-width: 24px;
      min-height: 24px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    @media (max-width: 639.98px) {
      .fc__x {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (focus.types().length > 0) {
      <span class="fc__chip" data-focus-chip>
        <span>{{ label() }}</span>
        <button
          type="button"
          class="fc__x"
          data-focus-remove
          aria-label="Clear the Focus in every section"
          (click)="focus.clear()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </span>
    }
  `,
})
export class FocusChip {
  protected readonly focus = inject(MyMattersFocus);
  private readonly options = inject(SectionTypes);
  protected readonly label = computed(() => focusLabel(this.focus.types(), this.options.options()));

  constructor() {
    this.options.ensure();
    this.focus.ensure();
  }
}
