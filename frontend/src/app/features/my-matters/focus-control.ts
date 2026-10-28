import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { OptionsMenu } from '../../shared/ui/options-menu';
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
 * clears the Focus everywhere. It is the shared Options menu under the name Focus (issue #919), so it opens, closes and takes the keyboard like every other menu.
 */
@Component({
  selector: 'mf-mm-focus',
  imports: [NgTemplateOutlet, OptionsMenu, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-block;
    }
    .fc__title {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .fc__inline .fc__list {
      width: auto;
    }
    .fc__hint {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .fc__list {
      width: min(20rem, 76vw);
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
      .fc__opt,
      .fc__actions .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (inline()) {
      <!-- Inside another menu (the phone's header menu): the checklist itself, no second popover. -->
      <section class="fc__inline" aria-labelledby="fc-inline-h" data-focus-inline>
        <h3 class="fc__title" id="fc-inline-h">Focus</h3>
        <ng-container *ngTemplateOutlet="panel" />
      </section>
    } @else {
      <!-- The same menu as every Options button (issue #919), under its own name; its number is how many task types are set. -->
      <mf-options-menu
        #menu
        label="Focus task types"
        text="Focus"
        icon="pi-bullseye"
        [active]="focus.types().length"
        [triggerName]="
          focus.types().length > 0 ? 'Focus, ' + focus.types().length + ' task types set' : 'Focus'
        "
        (opened)="opened()"
        data-focus
      >
        <ng-container *ngTemplateOutlet="panel" />
      </mf-options-menu>
    }
    <ng-template #panel>
      <div data-focus-panel>
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
          <button
            type="button"
            class="mf-btn mf-btn--primary"
            data-focus-save
            [attr.data-options-pick]="inline() ? '' : null"
            (click)="save()"
          >
            Save
          </button>
          <button
            type="button"
            class="mf-btn"
            data-focus-clear
            [attr.data-options-pick]="inline() ? '' : null"
            (click)="clearAll()"
          >
            Clear
          </button>
        </div>
      </div>
    </ng-template>
  `,
})
export class FocusControl {
  protected readonly focus = inject(MyMattersFocus);
  protected readonly options = inject(SectionTypes);
  private readonly menu = viewChild<OptionsMenu>('menu');
  /** Drawn inside another menu (the phone's header menu): the checklist alone, with a heading, no popover of its own. */
  readonly inline = input(false);
  protected readonly draft = signal<number[]>([]);

  constructor() {
    this.options.ensure();
    this.focus.ensure();
    // Inline there is no "opened" moment: the draft follows the saved Focus.
    effect(() => {
      const saved = this.focus.types();
      if (this.inline()) untracked(() => this.draft.set([...saved]));
    });
  }

  /** Opening starts from the saved Focus, so a closed-without-saving panel never keeps a half choice. */
  protected opened(): void {
    this.draft.set([...this.focus.types()]);
  }

  protected toggle(id: number): void {
    const now = this.draft();
    this.draft.set(now.includes(id) ? now.filter((t) => t !== id) : [...now, id]);
  }

  protected save(): void {
    this.focus.set(this.draft());
    this.menu()?.closeAndReturn();
  }

  protected clearAll(): void {
    this.focus.clear();
    this.draft.set([]);
    this.menu()?.closeAndReturn();
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
