import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from '../ui/dialog-focus';
import { GridNav } from '../ui/grid-nav';
import type { TaskTypeIconDef } from './task-type-icon-catalog.generated';
import { TaskTypeIcon } from './task-type-icon';
import { TaskTypeIconLibrary } from './task-type-icon-library';

interface IconGroup {
  category: string;
  icons: TaskTypeIconDef[];
}

const SEARCH_SEPARATORS = /[\s\-_/&(),.]+/;

function tokens(text: string): string[] {
  return text.toLowerCase().split(SEARCH_SEPARATORS).filter(Boolean);
}

/**
 * How well one typed word matches an icon (lower is better, null is no match): 0 the whole label, 1 a whole word of the label, key or
 * keywords, 2 the start of a label word, 3 the start of a key or keyword word, 4 anywhere inside ("tar" inside "start" ranks last).
 */
function wordTier(icon: TaskTypeIconDef, word: string): number | null {
  const label = icon.label.toLowerCase();
  if (label === word) return 0;
  const labelTokens = tokens(icon.label);
  const otherTokens = [...tokens(icon.key), ...tokens(icon.keywords)];
  if (labelTokens.includes(word) || otherTokens.includes(word)) return 1;
  if (labelTokens.some((t) => t.startsWith(word))) return 2;
  if (otherTokens.some((t) => t.startsWith(word))) return 3;
  const haystack =
    `${label} ${icon.key.replace(/-/g, ' ')} ${icon.keywords} ${icon.category}`.toLowerCase();
  return haystack.includes(word) ? 4 : null;
}

/**
 * Relevance of an icon to the typed words (every word must match somewhere); lower is better, `null` when it does not match.
 * Exact and word-prefix matches come before plain substrings (UXR4-09).
 */
export function iconScore(icon: TaskTypeIconDef, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let total = 0;
  for (const w of words) {
    const tier = wordTier(icon, w);
    if (tier === null) return null;
    total += tier;
  }
  return total / words.length;
}

/** True when every word typed appears in the icon's label, key, keywords or category. */
export function iconMatches(icon: TaskTypeIconDef, query: string): boolean {
  return iconScore(icon, query) !== null;
}

/** The icons that match, best match first (catalog order within equal scores); the catalog order when nothing is typed. */
export function rankIcons(icons: readonly TaskTypeIconDef[], query: string): TaskTypeIconDef[] {
  if (query.trim() === '') return [...icons];
  return icons
    .map((icon, index) => ({ icon, index, score: iconScore(icon, query) }))
    .filter((r): r is { icon: TaskTypeIconDef; index: number; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((r) => r.icon);
}

/**
 * Task Type icon picker: a button showing the current icon and its name opens a tall dialog with a search box, a row of category
 * buttons (All and the 12 categories, with counts) and the library grouped by category (EDRM stage first). While something is typed
 * the matches are one list, best match first. Every icon is a radio-like button with a visible label; arrows move between them, Enter
 * or Space picks. Every way of closing the dialog returns focus to the opener button.
 * The icon library loads when the picker is first shown, never with the initial bundle.
 */
@Component({
  selector: 'mf-task-type-icon-picker',
  imports: [Dialog, DialogFocus, GridNav, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './task-type-icon-picker.html',
  styleUrl: './task-type-icon-picker.scss',
})
export class TaskTypeIconPicker {
  private readonly library = inject(TaskTypeIconLibrary);

  /** The chosen icon key (two-way). */
  readonly value = model.required<string>();
  /** Id of the trigger button, so a label can point at it. */
  readonly inputId = input('tt-icon');
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);
  /** Id of the field label outside the picker; the button's accessible name is that label plus its own visible text (WCAG 2.5.3). */
  readonly labelId = input<string | null>(null);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly visible = signal(false);
  protected readonly query = signal('');
  protected readonly loadFailed = signal(false);
  private readonly catalog = signal<readonly TaskTypeIconDef[]>([]);
  private readonly categories = signal<readonly string[]>([]);
  protected readonly activeKey = signal<string | null>(null);
  /** The category button that is on; empty is All. */
  protected readonly category = signal('');

  protected readonly current = computed(
    () => this.catalog().find((i) => i.key === this.value()) ?? null,
  );
  /** Icons matching the typed words, best match first when something is typed (all categories). */
  private readonly matching = computed(() => rankIcons(this.catalog(), this.query()));
  protected readonly searching = computed(() => this.query().trim() !== '');
  /** The category buttons with how many icons each holds for the current search. */
  protected readonly categoryButtons = computed(() => {
    const matching = this.matching();
    return this.categories().map((name) => ({
      name,
      count: matching.filter((i) => i.category === name).length,
    }));
  });
  protected readonly groups = computed<IconGroup[]>(() => {
    const only = this.category();
    const matching = this.matching().filter((i) => !only || i.category === only);
    if (this.searching()) {
      return matching.length > 0 ? [{ category: 'Matches, best first', icons: matching }] : [];
    }
    return this.categories()
      .map((category) => ({ category, icons: matching.filter((i) => i.category === category) }))
      .filter((g) => g.icons.length > 0);
  });
  protected readonly totalCount = computed(() => this.matching().length);
  protected readonly matchCount = computed(() =>
    this.groups().reduce((n, g) => n + g.icons.length, 0),
  );
  /** The one item in the tab order (roving tabindex): the focused one, else the chosen one, else the first. */
  protected readonly tabStop = computed(() => {
    const keys = this.groups().flatMap((g) => g.icons.map((i) => i.key));
    const active = this.activeKey();
    if (active && keys.includes(active)) return active;
    return keys.includes(this.value()) ? this.value() : (keys[0] ?? null);
  });

  constructor() {
    void this.loadCatalog();
  }

  protected async loadCatalog(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const m = await this.library.catalog();
      this.catalog.set(m.TASK_TYPE_ICON_CATALOG);
      this.categories.set(m.TASK_TYPE_ICON_CATEGORIES);
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected open(): void {
    this.query.set('');
    this.category.set('');
    this.activeKey.set(null);
    this.visible.set(true);
  }

  protected pick(key: string): void {
    this.value.set(key);
    this.visible.set(false);
  }

  /** Runs after the dialog has closed by any path (Escape, X, a pick, a click outside): focus goes back to the opener. */
  protected onHide(): void {
    setTimeout(() => this.trigger()?.nativeElement.focus({ preventScroll: true }), 0);
  }

  protected setCategory(name: string): void {
    this.category.set(name);
    const scroller = this.scroller()?.nativeElement;
    if (scroller) scroller.scrollTop = 0;
  }

  /** Ids of the button's own visible text, so the accessible name contains what is shown. */
  protected readonly nameId = computed(() => `${this.inputId()}-name`);
  protected readonly hintId = computed(() => `${this.inputId()}-hint`);
  protected readonly buttonLabelledBy = computed(() => {
    const own = `${this.nameId()} ${this.hintId()}`;
    const label = this.labelId();
    return label ? `${label} ${own}` : own;
  });

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
