import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FixedPage } from './fixed-page';

/** A tag the filter offers, with how many steps carry it. */
export interface TagOption {
  name: string;
  count: number;
}

export type TagMatch = 'all' | 'any';

/**
 * The tag filter of the Workflow Steps list and of the workflow designer's step picker: a "Tags" button opens a small panel with a
 * checkbox per existing tag (with its step count; a text box narrows long lists), the chosen tags show as removable chips beside it,
 * and a "Match all / Match any" choice says whether a step needs every chosen tag (the default) or just one. The page owns the
 * selection (in the address for the list); this component only reports changes.
 */
@Component({
  selector: 'mf-tag-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.tf--pinned]': 'pinned' },
  template: `
    <div class="tf" role="group" [attr.aria-label]="label()">
      <div class="tf__bar">
        <button
          #toggleBtn
          type="button"
          class="tf__button mf-btn"
          [id]="idPrefix() + '-button'"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="idPrefix() + '-panel'"
          (click)="toggleOpen()"
        >
          <i class="pi pi-tag" aria-hidden="true"></i>
          {{ label() }}
          @if (selected().length > 0) {
            <span class="tf__badge" data-tag-filter-count>{{ selected().length }}</span>
            <span class="tf__sr">selected</span>
          }
          <i
            class="pi"
            [class.pi-chevron-down]="!open()"
            [class.pi-chevron-up]="open()"
            aria-hidden="true"
          ></i>
        </button>
        <fieldset class="tf__match" [disabled]="false">
          <legend class="tf__sr">Tag matching</legend>
          <label class="tf__radio">
            <input
              type="radio"
              [name]="idPrefix() + '-match'"
              value="all"
              [checked]="match() === 'all'"
              (change)="matchChange.emit('all')"
            />
            Match all
          </label>
          <label class="tf__radio">
            <input
              type="radio"
              [name]="idPrefix() + '-match'"
              value="any"
              [checked]="match() === 'any'"
              (change)="matchChange.emit('any')"
            />
            Match any
          </label>
        </fieldset>
        @for (tag of selected(); track tag) {
          <span class="tf__chip" [attr.data-selected-tag]="tag">
            <span class="tf__chip-text" [attr.title]="tag">{{ tag }}</span>
            <button
              type="button"
              class="tf__chip-remove"
              [attr.aria-label]="'Remove tag filter ' + tag"
              (click)="uncheck(tag)"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </span>
        }
      </div>
      @if (open()) {
        <div
          class="tf__panel"
          [class.tf__panel--end]="alignEnd()"
          role="group"
          [id]="idPrefix() + '-panel'"
          [attr.aria-label]="'Choose ' + label().toLowerCase()"
          (keydown.escape)="close(true)"
        >
          @if (options().length > 8) {
            <input
              type="search"
              class="mf-control tf__find"
              autocomplete="off"
              [attr.aria-label]="'Find a tag'"
              placeholder="Find a tag"
              [value]="needle()"
              (input)="needle.set($any($event.target).value)"
            />
          }
          @if (shown().length === 0) {
            <p class="tf__empty" role="status">
              {{ options().length === 0 ? 'No tags yet.' : 'No tag matches.' }}
            </p>
          } @else {
            <ul class="tf__list" aria-label="Tags">
              @for (o of shown(); track o.name) {
                <li>
                  <label class="tf__option">
                    <input
                      type="checkbox"
                      [checked]="isSelected(o.name)"
                      [attr.data-tag-option]="o.name"
                      (change)="toggle($any($event.target).checked, o.name)"
                    />
                    <span class="tf__name">{{ o.name }}</span
                    >{{ ' ' }}<span class="tf__count">({{ o.count }})</span>
                  </label>
                </li>
              }
            </ul>
          }
          @if (selected().length > 0) {
            <button type="button" class="tf__clear" (click)="selectedChange.emit([])">
              Clear tags
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .tf {
      position: relative;
    }
    .tf__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .tf__button {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h);
    }
    .tf__badge {
      min-width: 1.25rem;
      padding: 0 var(--mf-s1);
      border-radius: 999px;
      background: var(--mf-primary);
      color: var(--mf-on-primary, #fff);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      text-align: center;
    }
    .tf__match {
      display: inline-flex;
      gap: var(--mf-s3);
      margin: 0;
      padding: 0;
      border: 0;
      font-size: var(--mf-fs-sm);
    }
    .tf__radio {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      white-space: nowrap;
      cursor: pointer;
    }
    .tf__chip {
      display: inline-flex;
      align-items: center;
      max-width: 14rem;
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .tf__chip-text {
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tf__chip-remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      margin-right: 2px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--mf-text-muted);
      cursor: pointer;
    }
    .tf__chip-remove:hover {
      background: var(--mf-border);
      color: var(--mf-text);
    }
    .tf__chip-remove:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .tf__chip-remove .pi {
      font-size: 0.7rem;
    }
    .tf__panel {
      position: absolute;
      top: calc(100% + var(--mf-s1));
      left: 0;
      z-index: 30;
      display: grid;
      gap: var(--mf-s2);
      box-sizing: border-box;
      width: min(22rem, calc(100vw - 2 * var(--mf-s4)));
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2, var(--mf-shadow-1));
    }
    .tf__panel--end {
      right: 0;
      left: auto;
    }
    .tf__list {
      display: grid;
      max-height: 14rem;
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
    }
    .tf__option {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 2rem;
      padding: 0 var(--mf-s1);
      cursor: pointer;
    }
    .tf__option:hover {
      background: var(--mf-surface-alt);
    }
    .tf__name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tf__count {
      margin-left: auto;
      color: var(--mf-text-muted);
    }
    .tf__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .tf__clear {
      justify-self: start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .tf__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class TagFilter {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly pinned = inject(FixedPage, { optional: true }) !== null;

  /** Prefix of the element ids. */
  readonly idPrefix = input.required<string>();
  readonly label = input('Tags');
  /** Existing tags with their counts (most used first). */
  readonly options = input<readonly TagOption[]>([]);
  /** The chosen tags. */
  readonly selected = input<readonly string[]>([]);
  readonly match = input<TagMatch>('all');

  readonly selectedChange = output<string[]>();
  readonly matchChange = output<TagMatch>();

  protected readonly open = signal(false);
  /** The panel is 22rem wide; when it would run past the right edge of the window it hangs from the right edge of the filter instead. */
  protected readonly alignEnd = signal(false);
  protected readonly needle = signal('');
  private readonly toggleButton = viewChild<ElementRef<HTMLButtonElement>>('toggleBtn');

  protected readonly shown = computed(() => {
    const needle = this.needle().trim().toLowerCase();
    return this.options().filter((o) => !needle || o.name.toLowerCase().includes(needle));
  });

  protected isSelected(name: string): boolean {
    const key = name.toLowerCase();
    return this.selected().some((t) => t.toLowerCase() === key);
  }

  protected toggleOpen(): void {
    const rem = parseFloat(getComputedStyle(this.host.nativeElement).fontSize) || 16;
    const left = this.host.nativeElement.getBoundingClientRect().left;
    this.alignEnd.set(left + 22 * rem > window.innerWidth - 16);
    this.open.update((v) => !v);
    this.needle.set('');
  }

  protected close(returnFocus: boolean): void {
    this.open.set(false);
    if (returnFocus) this.toggleButton()?.nativeElement.focus();
  }

  protected toggle(checked: boolean, name: string): void {
    const rest = this.selected().filter((t) => t.toLowerCase() !== name.toLowerCase());
    this.selectedChange.emit(checked ? [...rest, name] : rest);
  }

  protected uncheck(name: string): void {
    this.selectedChange.emit(this.selected().filter((t) => t !== name));
  }

  /** Clicking or tabbing outside the panel closes it. */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  @HostListener('focusout', ['$event'])
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && next && !this.host.nativeElement.contains(next)) this.close(false);
  }
}
