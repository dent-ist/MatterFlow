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
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { StepDefinitionSummary, StepDefinitionsClient } from '../../../api/generated/api-client';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { SearchBox } from '../../../shared/ui/search-box';
import { TagChips } from '../../../shared/ui/tag-chips';
import { TagFilter, TagMatch, TagOption } from '../../../shared/ui/tag-filter';

export type LibraryLoadState = 'loading' | 'ready' | 'error';

/** The most steps the library lists at once; a longer library says so and asks to search. */
export const LIBRARY_PAGE_SIZE = 50;

/**
 * What the step library of the version page knows: the search text, the tag filter and the first page of matching active steps. The page
 * owns one, so the same list serves the left pane (1280 px and wider) and the drawer (narrower) and keeps its search between openings.
 */
export class StepLibraryModel {
  readonly items = signal<StepDefinitionSummary[]>([]);
  readonly state = signal<LibraryLoadState>('loading');
  readonly q = signal('');
  readonly tags = signal<string[]>([]);
  readonly match = signal<TagMatch>('all');
  readonly tagOptions = signal<TagOption[]>([]);
  /** Steps added since the panel was opened ("3 added"). */
  readonly added = signal(0);
  private readonly total = signal(0);
  private request = 0;

  readonly countText = computed(() => {
    const shown = this.items().length;
    const total = this.total();
    if (total > shown)
      return `Showing the first ${shown} of ${total} steps. Search to narrow the list.`;
    return shown === 1 ? '1 step' : `${shown} steps`;
  });

  constructor(private readonly steps: StepDefinitionsClient) {}

  async load(): Promise<void> {
    const id = ++this.request;
    this.state.set('loading');
    try {
      const result = await firstValueFrom(
        this.steps.listStepDefinitions(
          undefined,
          this.q().trim() || undefined,
          undefined,
          undefined,
          undefined,
          this.tags().length > 0 ? this.tags() : undefined,
          this.match() === 'any' ? 'any' : undefined,
          true,
          1,
          LIBRARY_PAGE_SIZE,
        ),
      );
      if (id !== this.request) return;
      this.items.set(result.items);
      this.total.set(result.total ?? result.items.length);
      this.state.set('ready');
    } catch {
      if (id === this.request) this.state.set('error');
    }
  }

  async loadTags(): Promise<void> {
    try {
      const tags = await firstValueFrom(this.steps.listStepTags(undefined, true, 200));
      this.tagOptions.set(tags.map((t) => ({ name: t.name, count: t.stepCount })));
    } catch {
      this.tagOptions.set([]); // the picker still searches by text
    }
  }

  search(text: string): void {
    this.q.set(text);
    void this.load();
  }

  setTags(tags: string[]): void {
    this.tags.set(tags);
    void this.load();
  }

  setMatch(match: TagMatch): void {
    this.match.set(match);
    if (this.tags().length > 1) void this.load();
  }
}

/**
 * The step library of the version page (VP3, #396): search, tag filter and the Add buttons. The Add buttons stay usable so several
 * steps can be added in a row ("3 added"); a step already in the version shows "Added". It is shown as a pane beside the steps from
 * 1280 px and as the content of a drawer below that.
 */
@Component({
  selector: 'mf-workflow-step-library',
  imports: [Button, ErrorReference, ScrollArea, SearchBox, TagChips, TagFilter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-step-library.scss',
  template: `
    <div class="wsl" data-library>
      <mf-search-box
        inputId="wf-lib-search"
        label="Search steps"
        placeholder="Title, description or tag"
        hint="Searches as you type by title, description or tag."
        [value]="model().q()"
        (searchChange)="model().search($event)"
      />
      <mf-tag-filter
        idPrefix="wf-lib-tags"
        label="Tags"
        [options]="model().tagOptions()"
        [selected]="model().tags()"
        [match]="model().match()"
        (selectedChange)="model().setTags($event)"
        (matchChange)="model().setMatch($event)"
      />
      <div class="wsl__results" [attr.aria-busy]="model().state() === 'loading'">
        @switch (model().state()) {
          @case ('loading') {
            @if (model().items().length === 0) {
              <p class="pg-muted" role="status">Loading steps...</p>
            }
          }
          @case ('error') {
            <div class="pg-alert" role="alert">
              Couldn't load the workflow steps.
              <mf-error-reference />
              <p-button label="Retry" severity="secondary" (onClick)="model().load()" />
            </div>
          }
        }
        @if (model().state() !== 'error') {
          @if (model().items().length === 0 && model().state() === 'ready') {
            <div class="pg-state" data-lib-empty>
              {{
                model().q() || model().tags().length > 0
                  ? 'No steps match that search. Try a different word, or clear the search and the tags.'
                  : 'There are no active workflow steps.'
              }}
            </div>
          } @else if (model().items().length > 0) {
            <p class="wsl__count" data-lib-count>{{ model().countText() }}</p>
            <div class="wsl__scroll" mfScrollArea="Library steps">
              <ul class="wsl__list" aria-label="Library steps">
                @for (s of model().items(); track s.stepDefinitionId) {
                  <li class="wsl__item" [attr.data-lib]="s.title">
                    <div class="wsl__text">
                      <span class="wsl__title" [attr.title]="s.title">{{ s.title }}</span>
                      @if (s.description) {
                        <span class="pg-muted wsl__desc">{{ s.description }}</span>
                      }
                      <mf-tag-chips [tags]="s.tags" [max]="3" />
                    </div>
                    <button
                      type="button"
                      class="mf-btn"
                      [attr.data-add]="s.stepDefinitionId"
                      [attr.aria-label]="
                        isAdded(s.stepDefinitionId)
                          ? s.title + ' is already in the workflow'
                          : 'Add ' + s.title + ' to the workflow'
                      "
                      [disabled]="isAdded(s.stepDefinitionId)"
                      (click)="pick(s)"
                    >
                      <i
                        class="pi"
                        [class.pi-plus]="!isAdded(s.stepDefinitionId)"
                        [class.pi-check]="isAdded(s.stepDefinitionId)"
                        aria-hidden="true"
                      ></i>
                      {{ isAdded(s.stepDefinitionId) ? 'Added' : 'Add' }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          }
        }
      </div>
      <p class="wsl__added" role="status" data-lib-added>
        @if (model().added() > 0) {
          {{ model().added() }} added
        }
      </p>
    </div>
  `,
})
export class WorkflowStepLibrary {
  readonly model = input.required<StepLibraryModel>();
  /** The ids of the steps already in the version. */
  readonly addedIds = input<ReadonlySet<number>>(new Set());
  readonly add = output<StepDefinitionSummary>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly isAdded = (id: number): boolean => this.addedIds().has(id);

  protected pick(step: StepDefinitionSummary): void {
    if (this.isAdded(step.stepDefinitionId)) return;
    this.model().added.update((n) => n + 1);
    this.add.emit(step);
    // The Add button becomes disabled; keep focus in the list on the next step that can still be added.
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[data-add]'),
    );
    const at = buttons.findIndex((b) => b.dataset['add'] === String(step.stepDefinitionId));
    const following = [...buttons.slice(at + 1), ...buttons.slice(0, Math.max(at, 0)).reverse()];
    const target = following.find((b) => !this.isAdded(Number(b.dataset['add'])));
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const next = target
          ? root.querySelector<HTMLElement>(`[data-add="${target.dataset['add']}"]:not(:disabled)`)
          : null;
        (next ?? root.querySelector<HTMLElement>('#wf-lib-search'))?.focus();
      },
      { injector: this.injector },
    );
  }
}
