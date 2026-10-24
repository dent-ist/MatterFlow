import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { SearchGroup, SearchHit } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import {
  SEARCH_ERROR_MESSAGE,
  SEARCH_TYPES,
  TextPart,
  highlightParts,
  isSearchable,
  noResultsMessage,
  searchTypeInfo,
  suggestionLines,
} from './search-meta';
import { Badge, SensitiveBadge } from '../ui/badge';
import type { LookupStore } from '../../core/lookups/lookup-store';
import { ScrollRegion } from '../ui/scroll-region';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** One keyboard-reachable row of the listbox: a hit, or the trailing "View all results" action. */
interface SearchOption {
  id: string;
  kind: 'hit' | 'all';
  hit?: SearchHit;
}

const MORE_CHARS_HINT = 'Type at least 2 characters to search.';

interface DisplayGroup {
  type: string;
  label: string;
  options: SearchOption[];
}

/**
 * Header search (UX S20): a debounced typeahead that shows up to five hits per object type, grouped Matters, Clients, Tasks, Projects, Assets.
 * ARIA 1.2 combobox with a listbox popup: Up/Down move, Enter opens the active hit (or the full results page when none is active), Escape closes.
 * Result counts and states are announced through a live region. Only the types the user may view come back (the server filters by permission).
 */
@Component({
  imports: [Badge, SensitiveBadge, ScrollRegion],
  selector: 'mf-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)', '(focusout)': 'onFocusOut($event)' },
  template: `
    <div class="mf-gs" role="search" aria-label="Search MatterFlow">
      <i class="pi pi-search" aria-hidden="true"></i>
      <input
        #box
        class="mf-gs__input"
        type="search"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-label="Search clients, matters, tasks, assets"
        placeholder="Search clients, matters, tasks, assets... (Ctrl+K)"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? listId : null"
        [attr.aria-activedescendant]="activeId()"
        [value]="query()"
        (input)="onInput($any($event.target).value)"
        (keydown)="onKeydown($event)"
        (focus)="onFocus()"
      />
      @if (open()) {
        <div class="mf-gs__panel" data-search-panel>
          @switch (panelState()) {
            @case ('loading') {
              <p class="mf-gs__note" data-state="loading">Searching...</p>
            }
            @case ('error') {
              <p class="mf-gs__note mf-gs__note--error" data-state="error">
                {{ errorMessage }}
                <button
                  type="button"
                  class="mf-gs__retry"
                  (mousedown)="$event.preventDefault()"
                  (click)="retry()"
                >
                  Try again
                </button>
              </p>
            }
            @case ('empty') {
              <p class="mf-gs__note" data-state="empty">{{ emptyMessage() }}</p>
            }
            @case ('hint') {
              <p class="mf-gs__note" data-state="hint">{{ MORE_CHARS_HINT }}</p>
            }
          }
          @if (groups().length > 0 || panelState() === 'empty') {
            <div class="mf-gs__scroll" mfScrollRegion="Search suggestions" data-search-scroll>
              <ul class="mf-gs__list" role="listbox" [id]="listId" aria-label="Search results">
                @for (group of groups(); track group.type) {
                  <li role="presentation">
                    <span
                      class="mf-gs__group"
                      [id]="listId + '-' + group.type"
                      role="presentation"
                      >{{ group.label }}</span
                    >
                    <ul
                      role="group"
                      [attr.aria-labelledby]="listId + '-' + group.type"
                      class="mf-gs__items"
                    >
                      @for (option of group.options; track option.id) {
                        @let lines = linesOf(option.hit!);
                        <li
                          role="option"
                          class="mf-gs__option"
                          data-hit
                          [id]="option.id"
                          [attr.title]="lines.tooltip"
                          [class.mf-gs__option--active]="option.id === activeId()"
                          [attr.aria-selected]="option.id === activeId()"
                          (mousedown)="$event.preventDefault()"
                          tabindex="-1"
                          (click)="choose(option)"
                          (keydown.enter)="choose(option)"
                          (mousemove)="hover(option)"
                        >
                          <span class="mf-gs__main">
                            @if (lines.reference; as reference) {
                              <span class="mf-gs__ref">{{ reference }}</span>
                            }
                            <span class="mf-gs__label">
                              @for (part of parts(option.hit!.label); track $index) {
                                @if (part.match) {
                                  <mark>{{ part.text }}</mark>
                                } @else {
                                  <span>{{ part.text }}</span>
                                }
                              }
                            </span>
                            @if (option.hit!.isSensitive && option.hit!.type === 'matter') {
                              <mf-sensitive-badge />
                            }
                            @if (!option.hit!.isActive) {
                              <mf-badge>Inactive</mf-badge>
                            }
                          </span>
                          @if (
                            lines.lock ||
                            lines.context.length > 0 ||
                            option.hit!.inMyMatters === false
                          ) {
                            <span class="mf-gs__sub">
                              @if (lines.lock) {
                                <i
                                  class="pi pi-lock mf-gs__lock"
                                  role="img"
                                  aria-label="Sensitive matter"
                                  data-sensitive-marker
                                ></i>
                              }
                              <span class="mf-gs__sub-text">{{ lines.context.join(' · ') }}</span>
                              @if (option.hit!.inMyMatters === false) {
                                <!-- Search stays global; a result outside the project manager's matters says so in words (epic #758, PX-16). -->
                                <span class="mf-gs__other" data-other-matter
                                  ><span class="mf-sr-only">, </span>Other matter</span
                                >
                              }
                            </span>
                          }
                        </li>
                      }
                    </ul>
                  </li>
                }
                @if (viewAll(); as all) {
                  <li
                    role="option"
                    class="mf-gs__option mf-gs__all"
                    data-view-all
                    [id]="all.id"
                    [class.mf-gs__option--active]="all.id === activeId()"
                    [attr.aria-selected]="all.id === activeId()"
                    (mousedown)="$event.preventDefault()"
                    tabindex="-1"
                    (click)="choose(all)"
                    (keydown.enter)="choose(all)"
                    (mousemove)="hover(all)"
                  >
                    View all results for "{{ trimmed() }}"
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      }
      <div class="mf-gs__live" role="status" aria-live="polite" data-live>{{ announcement() }}</div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      flex: 1;
      max-width: 640px;
    }
    .mf-gs {
      position: relative;
    }
    .pi-search {
      position: absolute;
      left: var(--mf-s3);
      top: 50%;
      transform: translateY(-50%);
      color: var(--mf-text-muted);
      pointer-events: none;
    }
    /* Styled explicitly (not via PrimeNG's .p-inputtext, whose CSS only loads once a PrimeNG input has rendered), so the box looks the same on every page. */
    .mf-gs__input {
      box-sizing: border-box;
      width: 100%;
      min-height: var(--mf-row-h);
      padding: 0 var(--mf-s3) 0 2.25rem;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .mf-gs__input::placeholder {
      color: var(--mf-text-muted);
      opacity: 1;
    }
    .mf-gs__panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      max-height: min(70vh, 32rem);
      overflow: hidden;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-2);
    }
    /* The only scroller of the panel: a named region while it overflows (BUG-1); the footer sticks to its bottom edge (BUG-3). */
    .mf-gs__scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      scroll-padding-bottom: var(--mf-row-h);
    }
    .mf-gs__list,
    .mf-gs__items {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .mf-gs__group {
      display: block;
      padding: var(--mf-s2) var(--mf-s3) var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .mf-gs__option {
      display: grid;
      gap: 2px;
      min-width: 0;
      min-height: var(--mf-row-h);
      align-content: center;
      padding: var(--mf-s2) var(--mf-s3);
      cursor: pointer;
    }
    .mf-gs__option--active {
      background: var(--mf-selected-bg);
    }
    /* One line per row: the name is cut with an ellipsis, never wrapped, so a long name or reference cannot widen the panel. */
    .mf-gs__main {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .mf-gs__ref {
      flex: none;
      font-family: var(--mf-font-mono);
    }
    .mf-gs__label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .mf-gs__sub {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s1);
      min-width: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mf-gs__sub-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* "Other matter": small, muted, text first; it keeps its place at the end of the second line when the context is cut. */
    .mf-gs__other {
      flex: none;
      margin-left: auto;
      padding-left: var(--mf-s2);
      font-size: var(--mf-fs-xs);
    }
    .mf-gs__lock {
      flex: none;
      font-size: var(--mf-fs-xs);
    }
    /* Pinned to the bottom of the scroller, so it is on screen without scrolling and one ArrowDown from the last hit. */
    .mf-gs__all {
      position: sticky;
      bottom: 0;
      z-index: 1;
      background: var(--mf-surface);
      border-top: 1px solid var(--mf-border);
      color: var(--mf-link);
      font-weight: 600;
    }
    .mf-gs__all.mf-gs__option--active {
      background: var(--mf-selected-bg);
    }
    .mf-gs__note {
      margin: 0;
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
    }
    .mf-gs__note--error {
      color: var(--mf-danger);
    }
    .mf-gs__retry {
      margin-left: var(--mf-s2);
      border: 0;
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    mark {
      background: transparent;
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
    }
    .mf-gs__live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class GlobalSearch {
  /** Delay between the last keystroke and the request (250 ms, architecture 14). */
  readonly debounceMs = input(250);
  /** Hits per type in the dropdown. */
  readonly perType = input(5);

  protected readonly listId = 'mf-global-search-list';
  protected readonly errorMessage = SEARCH_ERROR_MESSAGE;

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Set on the first search (loaded lazily with the API client, which the initial bundle must not carry). */
  private readonly lookups = signal<LookupStore | null>(null);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly query = signal('');
  protected readonly open = signal(false);
  private readonly state = signal<LoadState>('idle');
  private readonly response = signal<SearchGroup[]>([]);
  private readonly activeIndex = signal(-1);

  protected readonly trimmed = computed(() => this.query().trim());
  protected readonly searchable = computed(() => isSearchable(this.query()));

  /** Groups in UX order, limited to the types the user may view (the server filters too). */
  protected readonly groups = computed<DisplayGroup[]>(() => {
    const byType = new Map(this.response().map((g) => [g.type, g]));
    return SEARCH_TYPES.filter(
      (t) => this.auth.has(t.permission) && (byType.get(t.type)?.items.length ?? 0) > 0,
    ).map((t) => ({
      type: t.type,
      label: t.label,
      options: byType
        .get(t.type)!
        .items.map((hit) => ({ id: `mf-gs-${t.type}-${hit.id}`, kind: 'hit' as const, hit })),
    }));
  });

  protected readonly viewAll = computed<SearchOption | null>(() =>
    this.searchable() && this.state() === 'ready' ? { id: 'mf-gs-view-all', kind: 'all' } : null,
  );

  /** Every option in keyboard order (hits group by group, then "View all results"). */
  private readonly options = computed<SearchOption[]>(() => {
    const list = this.groups().flatMap((g) => g.options);
    const all = this.viewAll();
    return all ? [...list, all] : list;
  });

  protected readonly activeId = computed(() =>
    this.open() ? (this.options()[this.activeIndex()]?.id ?? null) : null,
  );

  /** One character that is not a digit: too short to search, so say so instead of showing nothing (UAT2-08). */
  protected readonly needsMore = computed(
    () => this.trimmed().length === 1 && !isSearchable(this.query()),
  );
  protected readonly MORE_CHARS_HINT = MORE_CHARS_HINT;

  protected readonly panelState = computed<'loading' | 'error' | 'empty' | 'results' | 'hint'>(
    () => {
      if (this.needsMore()) return 'hint';
      if (this.state() === 'loading') return 'loading';
      if (this.state() === 'error') return 'error';
      return this.groups().length === 0 ? 'empty' : 'results';
    },
  );

  protected readonly emptyMessage = computed(() => noResultsMessage(this.trimmed()));

  /** What assistive technology hears when the popup content changes. */
  protected readonly announcement = computed(() => {
    if (this.open() && this.needsMore()) return MORE_CHARS_HINT;
    if (!this.open() || !this.searchable()) return '';
    switch (this.panelState()) {
      case 'loading':
        return 'Searching';
      case 'error':
        return SEARCH_ERROR_MESSAGE;
      case 'empty':
        return noResultsMessage(this.trimmed());
      default: {
        const count = this.groups().reduce((n, g) => n + g.options.length, 0);
        return `${count} ${count === 1 ? 'result' : 'results'} available. Use the up and down arrow keys to review, Enter to open.`;
      }
    }
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // Keyboard moves keep the active option on screen; the focus stays in the input (aria-activedescendant).
    effect(() => {
      const id = this.activeId();
      if (!id) return;
      afterNextRender(
        () =>
          this.host.nativeElement.querySelector(`#${id}`)?.scrollIntoView?.({ block: 'nearest' }),
        { injector: this.injector },
      );
    });
  }

  /** Moves focus to the box (the shell's Ctrl+K). */
  focus(): void {
    const input = this.box().nativeElement;
    input.focus();
    input.select();
  }

  protected parts(text: string): TextPart[] {
    return highlightParts(text, this.trimmed());
  }

  /** What an option shows besides its name (reference, tooltip, muted line, lock): see `suggestionLines`. */
  protected linesOf(hit: SearchHit) {
    return suggestionLines(hit, (code) => this.lookups()?.statusLabel(code) ?? code);
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(-1);
    clearTimeout(this.timer);
    ++this.requestId; // a response for an older text is no longer wanted
    if (!isSearchable(value)) {
      this.state.set('idle');
      this.response.set([]);
      this.open.set(value.trim().length === 1);
      return;
    }
    this.state.set('loading');
    this.open.set(true);
    this.timer = setTimeout(() => void this.run(value.trim()), this.debounceMs());
  }

  protected onFocus(): void {
    if (this.searchable() && this.state() !== 'idle') this.open.set(true);
  }

  protected retry(): void {
    this.state.set('loading');
    void this.run(this.trimmed());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        if (!this.searchable()) return;
        event.preventDefault();
        if (!this.open() && this.state() !== 'idle') this.open.set(true);
        else if (count > 0) this.activeIndex.set((this.activeIndex() + 1) % count);
        break;
      case 'ArrowUp':
        if (!this.searchable()) return;
        event.preventDefault();
        // From the input (nothing active) the first ArrowUp wraps to the last option, "View all results".
        if (count > 0)
          this.activeIndex.set(
            this.activeIndex() < 0 ? count - 1 : (this.activeIndex() - 1 + count) % count,
          );
        break;
      case 'Home':
      case 'End':
        if (this.open() && this.activeIndex() >= 0 && count > 0) {
          event.preventDefault();
          this.activeIndex.set(event.key === 'Home' ? 0 : count - 1);
        }
        break;
      case 'Enter': {
        event.preventDefault();
        const active = this.options()[this.activeIndex()];
        if (this.open() && active) this.choose(active);
        else if (this.searchable()) this.goToResults();
        break;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.close();
        } else if (this.query() !== '') {
          event.preventDefault();
          this.query.set('');
          this.state.set('idle');
          this.response.set([]);
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  protected hover(option: SearchOption): void {
    const index = this.options().findIndex((o) => o.id === option.id);
    if (index >= 0 && index !== this.activeIndex()) this.activeIndex.set(index);
  }

  protected choose(option: SearchOption): void {
    this.close();
    if (option.kind === 'all') this.goToResults();
    else if (option.hit) void this.router.navigateByUrl(option.hit.path);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && next && !this.host.nativeElement.contains(next)) this.close();
  }

  private close(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  private goToResults(): void {
    this.close();
    void this.router.navigate(['/search'], { queryParams: { q: this.trimmed() } });
  }

  private async run(text: string): Promise<void> {
    const id = this.requestId;
    try {
      const types = SEARCH_TYPES.filter((t) => this.auth.has(t.permission)).map((t) => t.type);
      // The generated API client module is large; load it on first search so it stays out of the initial bundle.
      const { SearchClient } = await import('../../api/generated/api-client');
      const { LookupStore } = await import('../../core/lookups/lookup-store');
      this.lookups.set(this.injector.get(LookupStore));
      const api = this.injector.get(SearchClient);
      const result = await firstValueFrom(api.search(text, types, this.perType()));
      if (id !== this.requestId) return;
      this.response.set(result.groups.filter((g) => searchTypeInfo(g.type)));
      this.state.set('ready');
    } catch {
      if (id !== this.requestId) return;
      this.response.set([]);
      this.state.set('error');
    }
  }
}
