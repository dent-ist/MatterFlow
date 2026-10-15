import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
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

/** True when every word typed appears in the icon's label, key or keywords. */
export function iconMatches(icon: TaskTypeIconDef, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack =
    `${icon.label} ${icon.key.replace(/-/g, ' ')} ${icon.keywords} ${icon.category}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/**
 * Task Type icon picker: a button showing the current icon and its name opens a dialog with a search box and the library grouped by
 * category (EDRM stage first). Every icon is a radio-like button with a visible label; arrows move between them, Enter or Space picks.
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

  protected readonly visible = signal(false);
  protected readonly query = signal('');
  protected readonly loadFailed = signal(false);
  private readonly catalog = signal<readonly TaskTypeIconDef[]>([]);
  private readonly categories = signal<readonly string[]>([]);
  protected readonly activeKey = signal<string | null>(null);

  protected readonly current = computed(
    () => this.catalog().find((i) => i.key === this.value()) ?? null,
  );
  protected readonly groups = computed<IconGroup[]>(() => {
    const q = this.query();
    const matching = this.catalog().filter((i) => iconMatches(i, q));
    return this.categories()
      .map((category) => ({ category, icons: matching.filter((i) => i.category === category) }))
      .filter((g) => g.icons.length > 0);
  });
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
    this.activeKey.set(null);
    this.visible.set(true);
  }

  protected pick(key: string): void {
    this.value.set(key);
    this.visible.set(false);
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
