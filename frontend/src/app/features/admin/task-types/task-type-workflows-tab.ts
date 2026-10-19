import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkflowOption } from '../../../core/lookups/workflow-lookup';
import { Badge } from '../../../shared/ui/badge';

/** One row of the table: a workflow the type is eligible for. `known` is false for an id the lookup does not list (no permission, or gone). */
export interface WorkflowRow {
  id: number;
  name: string;
  known: boolean;
  active: boolean;
  publishedVersionNo: number | null;
  stepCount: number | null;
}

/** One entry of the Add workflow list; `reason` is set for a workflow that cannot be added and says why. */
export interface WorkflowChoice {
  id: number;
  name: string;
  publishedVersionNo: number | null;
  reason: string | null;
}

export const REASON_NOT_PUBLISHED = 'No published version';
export const REASON_INACTIVE = 'Inactive';

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The rows for the eligible ids, by name; ids the lookup does not know come last as `Workflow n`. */
export function workflowRows(
  eligible: readonly number[],
  workflows: readonly WorkflowOption[],
): WorkflowRow[] {
  const byId = new Map(workflows.map((w) => [w.id, w]));
  const known: WorkflowRow[] = [];
  const unknown: WorkflowRow[] = [];
  for (const id of eligible) {
    const w = byId.get(id);
    if (w) {
      known.push({
        id,
        name: w.name,
        known: true,
        active: w.isActive !== false,
        publishedVersionNo: w.publishedVersionNo ?? null,
        stepCount: w.stepCount ?? null,
      });
    } else {
      unknown.push({
        id,
        name: `Workflow ${id}`,
        known: false,
        active: true,
        publishedVersionNo: null,
        stepCount: null,
      });
    }
  }
  return [...known.sort(byName), ...unknown.sort((a, b) => a.id - b.id)];
}

/**
 * What the Add workflow list offers (TE2, #383): every workflow that is not added yet and matches the search. Published and active ones can be
 * added; the others are listed after them, disabled, with the reason ("Inactive", "No published version") so the administrator learns why.
 */
export function workflowChoices(
  eligible: readonly number[],
  workflows: readonly WorkflowOption[],
  query: string,
): WorkflowChoice[] {
  const taken = new Set(eligible);
  const q = query.trim().toLocaleLowerCase();
  const all = workflows
    .filter((w) => !taken.has(w.id) && (!q || w.name.toLocaleLowerCase().includes(q)))
    .map((w): WorkflowChoice => ({
      id: w.id,
      name: w.name,
      publishedVersionNo: w.publishedVersionNo ?? null,
      reason:
        w.isActive === false
          ? REASON_INACTIVE
          : !w.publishedVersionNo
            ? REASON_NOT_PUBLISHED
            : null,
    }));
  return [
    ...all.filter((c) => !c.reason).sort(byName),
    ...all.filter((c) => c.reason).sort(byName),
  ];
}

/** What a change of the table sends up: the new eligible ids and default, and the sentence to say aloud. */
export interface WorkflowsChange {
  eligible: number[];
  defaultId: number | null;
  message: string;
}

/** Adds a workflow; the first one added becomes the default. */
export function addWorkflow(
  eligible: readonly number[],
  defaultId: number | null,
  added: { id: number; name: string },
): WorkflowsChange {
  const next = [...new Set([...eligible, added.id])].sort((a, b) => a - b);
  const becomesDefault = defaultId === null || !next.includes(defaultId);
  return {
    eligible: next,
    defaultId: becomesDefault ? added.id : defaultId,
    message: becomesDefault
      ? `${added.name} added and is now the default workflow.`
      : `${added.name} added.`,
  };
}

/**
 * Removes a workflow. Removing the default moves the default to the next row of the table (the one below, else the one above), and the
 * sentence says so; with no row left there is no default.
 */
export function removeWorkflow(
  rows: readonly WorkflowRow[],
  eligible: readonly number[],
  defaultId: number | null,
  removed: WorkflowRow,
): WorkflowsChange {
  const next = eligible.filter((id) => id !== removed.id);
  if (defaultId !== removed.id) {
    return { eligible: next, defaultId, message: `${removed.name} removed.` };
  }
  const at = rows.findIndex((r) => r.id === removed.id);
  const successor = rows[at + 1] ?? rows[at - 1] ?? null;
  return {
    eligible: next,
    defaultId: successor?.id ?? null,
    message: successor
      ? `${removed.name} removed. ${successor.name} is now the default workflow.`
      : `${removed.name} removed. There is no default workflow.`,
  };
}

/** How many entries the Add workflow list shows at once; more are reached by typing (the list never needs a scroll of its own). */
export const PICKER_LIMIT = 8;

let nextId = 0;

/**
 * The Workflows tab of a Task Type (TE2, #382, #383): a table of the workflows people can choose for the type (name, published version, steps,
 * a Default radio, Remove) and an "Add workflow" combobox with search. The page owns the data and saves it; this component says what changed.
 *
 * Keyboard: the Default radios are one Tab stop (arrows move the choice); Remove has the name "Remove <workflow>" and focus moves to the next
 * Remove (else the previous one, else the search) after it; the combobox follows the ARIA pattern (arrows move, Enter adds, Escape closes,
 * a disabled entry can be reached so its reason is read, but it cannot be chosen).
 */
@Component({
  selector: 'mf-task-type-workflows-tab',
  imports: [RouterLink, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './task-type-workflows-tab.scss',
  template: `
    <section class="wt" aria-labelledby="tt-wf-h" data-workflows-tab>
      <h2 id="tt-wf-h" class="wt__h">Eligible workflows</h2>
      <p class="muted wt__lead">
        People choose one of these when they create a task of this type. A type needs at least one
        published, active workflow to be usable.
      </p>

      @if (canAdd()) {
        <div class="wt__add" data-add-workflow>
          <label class="wt__add-label" [for]="uid + '-add'">Add workflow</label>
          <div class="wt__box">
            <input
              #search
              type="text"
              class="wt__input"
              role="combobox"
              autocomplete="off"
              aria-autocomplete="list"
              placeholder="Search workflows"
              [id]="uid + '-add'"
              [attr.aria-expanded]="open()"
              [attr.aria-controls]="uid + '-list'"
              [attr.aria-activedescendant]="activeId()"
              [attr.aria-describedby]="uid + '-help'"
              [value]="query()"
              (input)="onInput($event)"
              (keydown)="onKey($event)"
              (click)="open.set(true)"
              (blur)="close()"
              data-add-input
            />
            @if (open()) {
              <ul
                class="wt__list"
                role="listbox"
                aria-label="Workflows you can add"
                [id]="uid + '-list'"
                data-add-list
              >
                @for (c of shown(); track c.id; let i = $index) {
                  <li
                    role="option"
                    class="wt__opt"
                    [id]="uid + '-opt-' + i"
                    [class.wt__opt--active]="i === active()"
                    [class.wt__opt--off]="!!c.reason"
                    [attr.aria-setsize]="choices().length"
                    [attr.aria-posinset]="i + 1"
                    [attr.aria-selected]="i === active()"
                    [attr.aria-disabled]="c.reason ? 'true' : null"
                    [attr.data-option]="c.id"
                    (mousedown)="$event.preventDefault(); choose(c)"
                  >
                    <span class="wt__opt-name">{{ c.name }}</span>
                    @if (c.reason) {
                      <span class="wt__opt-why" data-option-reason>{{ c.reason }}</span>
                    } @else {
                      <span class="wt__opt-why">Published v{{ c.publishedVersionNo }}</span>
                    }
                  </li>
                } @empty {
                  <li class="wt__note" role="presentation" data-add-empty>
                    {{
                      everyWorkflowAdded()
                        ? 'Every workflow is already added.'
                        : 'No workflows match.'
                    }}
                  </li>
                }
                @if (choices().length > shown().length) {
                  <li class="wt__note" role="presentation" data-add-more>
                    Showing {{ shown().length }} of {{ choices().length }}. Keep typing to narrow
                    the list.
                  </li>
                }
              </ul>
            }
          </div>
          <p class="muted wt__help" [id]="uid + '-help'">
            Type to search. Workflows without a published version and inactive ones are listed with
            the reason and cannot be added.
          </p>
        </div>
      } @else {
        <p class="muted wt__help" data-cannot-add>
          You can remove a workflow here. To add one you need permission to manage workflows.
        </p>
      }

      @if (rows().length === 0) {
        <p class="wt__empty" data-no-workflows>
          No workflows yet. Add one with the search below; the first one you add becomes the
          default.
        </p>
      } @else {
        <table class="wt__table" data-workflows>
          <caption class="mf-sr-only">
            Eligible workflows
          </caption>
          <thead>
            <tr>
              <th scope="col">Workflow</th>
              <th scope="col" class="wt__pub">Published</th>
              <th scope="col" class="wt__steps">Steps</th>
              <th scope="col" class="wt__def">Default</th>
              <th scope="col" class="wt__rm"><span class="mf-sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr [attr.data-workflow]="r.id" [class.wt__row--default]="r.id === defaultId()">
                <th scope="row" class="wt__name">
                  <div class="wt__nm">
                    @if (canLink() && r.known) {
                      <a
                        class="wt__title"
                        [routerLink]="['/admin/workflows', r.id]"
                        [attr.title]="r.name"
                        data-wf-link
                        >{{ r.name }}</a
                      >
                    } @else {
                      <span class="wt__title" [attr.title]="r.name">{{ r.name }}</span>
                    }
                    @if (r.known && !r.active) {
                      <mf-badge>Inactive</mf-badge>
                    }
                  </div>
                </th>
                <td class="wt__pub">
                  @if (!r.known) {
                    <span class="muted" aria-label="Not shown">--</span>
                  } @else if (r.publishedVersionNo) {
                    <span class="wt__lbl" aria-hidden="true">Published </span>v{{
                      r.publishedVersionNo
                    }}
                  } @else {
                    <mf-badge data-not-published>Not published</mf-badge>
                  }
                </td>
                <td class="wt__steps">
                  @if (r.stepCount !== null && r.publishedVersionNo) {
                    <span class="wt__lbl" aria-hidden="true">Steps </span>{{ r.stepCount }}
                  } @else {
                    <span class="muted" aria-label="No steps shown">--</span>
                  }
                </td>
                <td class="wt__def">
                  <label class="wt__radio">
                    <input
                      type="radio"
                      [name]="uid + '-default'"
                      [checked]="r.id === defaultId()"
                      [attr.aria-label]="'Make ' + r.name + ' the default workflow'"
                      [attr.data-default-radio]="r.id"
                      (change)="setDefault(r)"
                    />
                    <span class="wt__lbl" aria-hidden="true">Default</span>
                  </label>
                </td>
                <td class="wt__rm">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text"
                    [attr.aria-label]="'Remove ' + r.name"
                    [attr.data-remove]="r.id"
                    (click)="remove(r)"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class TaskTypeWorkflowsTab {
  readonly workflows = input.required<readonly WorkflowOption[]>();
  readonly eligible = input.required<readonly number[]>();
  readonly defaultId = input<number | null>(null);
  /** Names link to the workflow (the viewer has `Workflow.Manage`). */
  readonly canLink = input(false);
  /** The Add workflow search is offered (the viewer can list workflows). */
  readonly canAdd = input(true);
  readonly changed = output<WorkflowsChange>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly uid = `ttwf-${nextId++}`;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);

  protected readonly rows = computed(() => workflowRows(this.eligible(), this.workflows()));
  protected readonly choices = computed(() =>
    workflowChoices(this.eligible(), this.workflows(), this.query()),
  );
  protected readonly shown = computed(() => this.choices().slice(0, PICKER_LIMIT));
  protected readonly everyWorkflowAdded = computed(
    () => this.query().trim() === '' && this.choices().length === 0,
  );
  protected readonly activeId = computed(() =>
    this.open() && this.active() >= 0 ? `${this.uid}-opt-${this.active()}` : null,
  );

  protected setDefault(r: WorkflowRow): void {
    if (r.id === this.defaultId()) return;
    this.changed.emit({
      eligible: [...this.eligible()],
      defaultId: r.id,
      message: `${r.name} is now the default workflow.`,
    });
  }

  protected remove(r: WorkflowRow): void {
    const rows = this.rows();
    const at = rows.findIndex((x) => x.id === r.id);
    const neighbour = rows[at + 1] ?? rows[at - 1] ?? null;
    this.changed.emit(removeWorkflow(rows, this.eligible(), this.defaultId(), r));
    afterNextRender(
      () => {
        const target = neighbour
          ? this.host.nativeElement.querySelector<HTMLElement>(`[data-remove="${neighbour.id}"]`)
          : this.host.nativeElement.querySelector<HTMLElement>('[data-add-input]');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected choose(c: WorkflowChoice): void {
    if (c.reason) return;
    this.changed.emit(addWorkflow(this.eligible(), this.defaultId(), { id: c.id, name: c.name }));
    this.query.set('');
    this.active.set(-1);
    this.open.set(false);
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.open.set(true);
    this.active.set(this.firstEnabled());
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  private firstEnabled(): number {
    const i = this.shown().findIndex((c) => !c.reason);
    return i >= 0 ? i : this.shown().length > 0 ? 0 : -1;
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.shown().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.open.set(true);
          this.active.set(this.firstEnabled());
          return;
        }
        if (n === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.active.set((this.active() + step + n) % n);
        return;
      }
      case 'Enter': {
        if (!this.open()) return;
        event.preventDefault();
        const c = this.shown()[this.active()];
        if (c) this.choose(c);
        return;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
      case 'Tab':
        this.close();
        return;
    }
  }
}
