import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PodChoice, UserPodDto } from '../../../core/identity-admin/identity-admin-api';
import {
  PodDraft,
  choosePrimary,
  initialDraft,
  needsPrimary,
  podRows,
  podsText,
  sameDraft,
  togglePod,
} from './user-pods-draft';

/** What Apply sends: every pod the person should be in and the primary one (none = no primary pod). */
export interface PodsChange {
  podIds: number[];
  primaryPodId: number | undefined;
}

/** The chips that fit a row; the rest is "+N" (all of them are in the accessible name and the tooltip). */
const MAX_CHIPS = 3;

let nextId = 0;

/**
 * The Pods cell of the Users grid (UX: pod assignment). Shows the person's pods as compact chips (the primary pod with a star and the
 * text "Primary", the others plain, an inactive pod muted) or "No pod". Without edit rights that is all. With them the chips are a button
 * that opens a small popover with a searchable checklist of the active pods, a "Primary" radio on each ticked pod, and Apply / Cancel:
 * nothing is sent per click, Apply emits ONE change for the whole person.
 *
 *   - The first pod of a person with no pods becomes the primary one. Unticking the primary pod clears it; the popover then asks for the
 *     new one (it never promotes another pod itself) and Apply stays blocked until one is chosen.
 *   - Inactive pods the person is already in stay visible and can be unticked; an inactive pod cannot be newly assigned (it is not offered).
 *   - Enter, Space or Arrow Down on the button opens it, Arrow Up / Down move through the search box and the checklist, Esc closes and
 *     returns focus to the button, Tab out or a click outside closes it without applying. The popover is fixed-positioned from the button
 *     so the grid's scroll area does not clip it.
 */
@Component({
  selector: 'mf-user-pods-cell',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #chipList>
      @if (pods().length === 0) {
        <span class="upc-none" data-no-pod>No pod</span>
      } @else {
        <span class="upc-chips">
          @for (p of shown(); track p.podId) {
            <span
              class="upc-chip"
              data-pod-chip
              [class.upc-chip--primary]="p.isPrimary"
              [class.upc-chip--inactive]="!p.isActive"
              [attr.data-primary]="p.isPrimary ? '' : null"
            >
              @if (p.isPrimary) {
                <i class="pi pi-star-fill" aria-hidden="true"></i>
              }
              <span class="upc-name">{{ p.name }}</span>
              @if (p.isPrimary) {
                &ngsp;<span class="upc-tag">Primary</span>
              }
              @if (!p.isActive) {
                &ngsp;<span class="upc-tag">inactive</span>
              }
            </span>
          }
          @if (hidden() > 0) {
            <span class="upc-chip upc-chip--more" data-pod-more [attr.title]="hiddenNames()"
              >+{{ hidden() }}</span
            >
          }
        </span>
        <span class="upc-count" data-pod-count aria-hidden="true"
          >{{ pods().length }} {{ pods().length === 1 ? 'pod' : 'pods' }}</span
        >
      }
    </ng-template>

    @if (canEdit()) {
      <button
        #trigger
        type="button"
        class="upc-trigger"
        data-pods-trigger
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? uid + '-pop' : null"
        [attr.aria-label]="triggerLabel()"
        [attr.title]="tooltip()"
        [attr.aria-busy]="busy() ? 'true' : null"
        [attr.aria-disabled]="busy() ? 'true' : null"
        (click)="toggle($event)"
        (keydown)="onTriggerKey($event)"
      >
        <span class="upc-value"><ng-container *ngTemplateOutlet="chipList" /></span>
        <i
          class="pi"
          [class]="busy() ? 'pi-spin pi-spinner' : 'pi-chevron-down'"
          aria-hidden="true"
        ></i>
      </button>
      @if (open()) {
        <div
          #pop
          class="upc-pop"
          role="dialog"
          data-pods-popover
          [id]="uid + '-pop'"
          [attr.aria-label]="'Change pods of ' + displayName()"
          [style.top.px]="pos().top"
          [style.left.px]="pos().left"
          [style.max-height.px]="pos().maxHeight"
          (click)="$event.stopPropagation()"
          (keydown)="onPopKey($event)"
          (focusout)="onFocusOut($event)"
        >
          <input
            #search
            type="text"
            class="upc-search"
            autocomplete="off"
            aria-label="Search pods"
            placeholder="Search pods"
            data-pods-search
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          @if (catalog() === null) {
            @if (catalogFailed()) {
              <p class="upc-note" role="alert" data-pods-failed>Pods could not be loaded.</p>
            } @else {
              <p class="upc-note" role="status">Loading...</p>
            }
          } @else if (visibleRows().length === 0) {
            <p class="upc-note" role="status" data-pods-empty>
              {{ query() ? 'No pods match.' : 'There are no active pods.' }}
            </p>
          }
          @if (visibleRows().length > 0) {
            <ul class="upc-list" aria-label="Pods">
              @for (r of visibleRows(); track r.podId) {
                <li class="upc-row" [class.upc-row--muted]="!r.isActive">
                  <label class="upc-check">
                    <input
                      type="checkbox"
                      [attr.data-pod-option]="r.podId"
                      [checked]="isSelected(r.podId)"
                      (change)="onToggle(r.podId, r.isActive, $any($event.target).checked)"
                    />
                    <span class="upc-label" [attr.title]="r.name">{{ r.name }}</span>
                    @if (!r.isActive) {
                      &ngsp;<span class="upc-tag">inactive</span>
                    }
                  </label>
                  @if (isSelected(r.podId)) {
                    <label class="upc-primary">
                      <input
                        type="radio"
                        [name]="uid + '-primary'"
                        [attr.data-pod-primary]="r.podId"
                        [attr.aria-label]="'Primary pod: ' + r.name"
                        [checked]="draft().primary === r.podId"
                        [disabled]="!r.isActive && draft().primary !== r.podId"
                        (change)="onPrimary(r.podId)"
                      />
                      Primary
                    </label>
                  }
                </li>
              }
            </ul>
          }
          @if (hasInactive()) {
            <p class="upc-foot" data-pods-inactive-note>
              Inactive pods can stay or be removed; they cannot be newly assigned.
            </p>
          }
          @if (askPrimary()) {
            <p class="upc-warn" role="alert" [id]="uid + '-why'" data-primary-required>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              Choose the primary pod before you apply.
            </p>
          }
          <div class="upc-actions">
            <button
              type="button"
              class="mf-btn mf-btn--primary"
              data-pods-apply
              [attr.aria-disabled]="canApply() ? null : 'true'"
              [attr.aria-describedby]="askPrimary() ? uid + '-why' : null"
              (click)="apply()"
            >
              Apply
            </button>
            <button type="button" class="mf-btn" data-pods-cancel (click)="close(true)">
              Cancel
            </button>
          </div>
        </div>
      }
    } @else {
      <span class="upc-static" data-pods-readonly [attr.title]="tooltip()">
        <ng-container *ngTemplateOutlet="chipList" />
      </span>
    }
  `,
  host: { '[class.upc--one]': 'oneLine()' },
  styles: `
    :host {
      display: inline-block;
      max-width: 100%;
    }
    /* One line (the Users grid): the chips never wrap, a long pod name is cut with an ellipsis (the whole text is in the button's name). */
    :host(.upc--one) {
      display: block;
    }
    :host(.upc--one) .upc-value,
    :host(.upc--one) .upc-static,
    :host(.upc--one) .upc-chips {
      flex-wrap: nowrap;
    }
    :host(.upc--one) .upc-trigger {
      max-width: 100%;
    }
    :host(.upc--one) .upc-chip {
      min-width: 0;
    }
    :host(.upc--one) .upc-name {
      overflow: hidden;
      max-width: 8.5rem;
      text-overflow: ellipsis;
    }
    :host(.upc--one) .upc-count {
      display: none;
    }
    .upc-value,
    .upc-static {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
      min-width: 0;
    }
    .upc-chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
    }
    .upc-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 1px var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      line-height: 1.4;
      white-space: nowrap;
    }
    .upc-chip--primary {
      border-color: var(--mf-info);
      background: var(--mf-info-bg);
      color: var(--mf-info);
      font-weight: 600;
    }
    .upc-chip--inactive {
      border-style: dashed;
      background: transparent;
      color: var(--mf-text-muted);
    }
    .upc-chip .pi {
      font-size: var(--mf-fs-xs);
    }
    .upc-tag {
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .upc-chip--inactive .upc-tag,
    .upc-row--muted .upc-tag {
      font-weight: 400;
      font-style: italic;
    }
    .upc-none,
    .upc-count {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .upc-trigger {
      max-width: 100%;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 1.75rem;
      padding: 0 var(--mf-s1);
      border: 1px solid transparent;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .upc-trigger:focus-visible,
    .upc-trigger[aria-expanded='true'] {
      border-color: var(--mf-border-strong);
      background: var(--mf-surface-alt);
    }
    .upc-trigger[aria-disabled='true'] {
      cursor: progress;
      opacity: 0.7;
    }
    .upc-trigger > .pi {
      color: var(--mf-text-muted);
      font-size: 0.875rem;
    }
    .upc-pop {
      position: fixed;
      z-index: 1100;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      width: 22rem;
      max-width: calc(100vw - 16px);
      overflow-y: auto;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
      font-size: var(--mf-fs-md);
    }
    .upc-search {
      box-sizing: border-box;
      width: 100%;
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .upc-list {
      margin: 0;
      padding: 0;
      max-height: 13rem;
      overflow-y: auto;
      list-style: none;
    }
    .upc-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      min-height: var(--mf-target-min, 2rem);
      padding: 0 var(--mf-s1);
    }
    .upc-row:hover {
      background: var(--mf-surface-alt);
    }
    .upc-row--muted {
      color: var(--mf-text-muted);
    }
    .upc-check,
    .upc-primary {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min, 2rem);
      cursor: pointer;
    }
    .upc-check {
      min-width: 0;
      flex: 1;
    }
    /* The popover shows the whole name: it wraps to two lines (a longer one is cut there, the full name is the tooltip). */
    .upc-label {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .upc-primary {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .upc-note,
    .upc-foot {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .upc-warn {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .upc-actions {
      display: flex;
      gap: var(--mf-s2);
      justify-content: flex-end;
      padding-top: var(--mf-s2);
      border-top: 1px solid var(--mf-border);
    }
  `,
})
export class UserPodsCell implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly displayName = input.required<string>();
  /** All of the person's pods (inactive ones too), by name, the primary one flagged. */
  readonly pods = input.required<readonly UserPodDto[]>();
  /** The active pods that can be assigned; null until loaded. */
  readonly catalog = input<readonly PodChoice[] | null>(null);
  readonly catalogFailed = input(false);
  /** The person may change pods (Pod.ManageMembers). */
  readonly canEdit = input(false);
  /** A save for this person is running. */
  readonly busy = input(false);
  /**
   * One line (the Users grid, rows are 44 px): the primary pod (else the first) and "+n" for the others; every pod stays in the tooltip and in the
   * accessible name. Off: up to three chips that may wrap (the pod's own screens).
   */
  readonly oneLine = input(false);

  /** The popover opened: the page loads the pod list if it has not yet. */
  readonly opened = output<void>();
  readonly applied = output<PodsChange>();

  protected readonly uid = `upc-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly draft = signal<PodDraft>({ selected: [], primary: null });
  protected readonly pos = signal<{ top: number; left: number; maxHeight: number | null }>({
    top: 0,
    left: 0,
    maxHeight: null,
  });
  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly popRef = viewChild<ElementRef<HTMLElement>>('pop');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  /** The pods the cell draws as chips: all that fit, or in one line the primary one (else the first). */
  private readonly chipPods = computed(() => {
    const pods = this.pods();
    if (!this.oneLine()) return { shown: pods.slice(0, MAX_CHIPS), rest: pods.slice(MAX_CHIPS) };
    const first = pods.find((p) => p.isPrimary) ?? pods[0];
    return first
      ? { shown: [first], rest: pods.filter((p) => p !== first) }
      : { shown: [], rest: [] };
  });
  protected readonly shown = computed(() => this.chipPods().shown);
  protected readonly hidden = computed(() => this.chipPods().rest.length);
  protected readonly hiddenNames = computed(() =>
    this.chipPods()
      .rest.map((p) => p.name)
      .join(', '),
  );

  /** Every pod, for the tooltip of the one-line cell (the cell itself shows the primary pod and "+n"). */
  protected readonly tooltip = computed(() =>
    this.oneLine() && this.pods().length > 1 ? podsText(this.pods()) : null,
  );

  /** "Pods: Processing (primary), Review, change pods of Jamal Okafor": the visible text first, then what the button does. */
  protected readonly triggerLabel = computed(() => {
    const text = this.pods().length ? podsText(this.pods()) : 'none';
    return `Pods: ${text}, change pods of ${this.displayName()}`;
  });

  private readonly rows = computed(() =>
    podRows(
      (this.catalog() ?? []).map((c) => ({ ...c, isActive: true })),
      this.pods(),
    ),
  );
  protected readonly visibleRows = computed(() => {
    const needle = this.query().trim().toLowerCase();
    return needle ? this.rows().filter((r) => r.name.toLowerCase().includes(needle)) : this.rows();
  });
  protected readonly hasInactive = computed(() => this.rows().some((r) => !r.isActive));
  private readonly original = computed(() => initialDraft(this.pods()));
  private readonly dirty = computed(() => !sameDraft(this.draft(), this.original()));
  private readonly blocked = computed(() => needsPrimary(this.draft(), this.rows()));
  protected readonly askPrimary = computed(() => this.dirty() && this.blocked());
  protected readonly canApply = computed(() => this.dirty() && !this.blocked());

  constructor() {
    // The list can grow when the pods arrive or the search narrows it: keep the popover on the side that fits.
    effect(() => {
      this.visibleRows();
      this.catalog();
      this.askPrimary();
      if (untracked(() => this.open())) setTimeout(() => this.place());
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.scrollTimer);
    document.removeEventListener('scroll', this.onScroll, true);
  }

  protected isSelected(podId: number): boolean {
    return this.draft().selected.includes(podId);
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    // Busy uses aria-disabled, not disabled: a disabled button would drop the focus.
    if (this.busy()) return;
    if (this.open()) this.close(true);
    else this.show();
  }

  show(): void {
    const button = this.trigger()?.nativeElement;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    this.pos.set({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 352 - 8)),
      maxHeight: null,
    });
    this.query.set('');
    this.draft.set(this.original());
    this.open.set(true);
    // Listen only once the page has settled: the scroll that brought the button into view must not close the popover.
    this.scrollTimer = setTimeout(
      () => document.addEventListener('scroll', this.onScroll, true),
      300,
    );
    this.opened.emit();
    setTimeout(() => {
      this.place();
      // No scrolling to the search box: a page scroll right after opening would close the popover (see onScroll).
      this.host.nativeElement
        .querySelector<HTMLElement>('.upc-search')
        ?.focus({ preventScroll: true });
    });
  }

  close(returnFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    clearTimeout(this.scrollTimer);
    document.removeEventListener('scroll', this.onScroll, true);
    if (returnFocus) this.trigger()?.nativeElement.focus();
  }

  protected apply(): void {
    if (!this.canApply()) return;
    const draft = this.draft();
    this.close(true);
    this.applied.emit({
      podIds: [...draft.selected].sort((a, b) => a - b),
      primaryPodId: draft.primary ?? undefined,
    });
  }

  protected onToggle(podId: number, isActive: boolean, on: boolean): void {
    this.draft.update((d) => togglePod(d, podId, on, isActive));
  }

  protected onPrimary(podId: number): void {
    this.draft.update((d) => choosePrimary(d, podId));
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    // Only the key this button handles stays here: Esc must still reach the drawer the button may sit in.
    if (event.key !== 'ArrowDown') return;
    event.stopPropagation();
    if (!this.open() && !this.busy()) {
      event.preventDefault();
      this.show();
    }
  }

  protected onPopKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const target = event.target as HTMLElement;
      // Radios keep their own arrow keys (they move between the Primary radios); the search box and the checkboxes walk the list.
      if (target instanceof HTMLInputElement && target.type === 'radio') return;
      event.preventDefault();
      const items = this.walkable();
      const index = items.indexOf(target);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  }

  /** Tab out of the popover closes it without applying. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) this.close(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  @HostListener('window:resize')
  protected onViewportChange(): void {
    this.close(false);
  }

  /** Scrolling anywhere but the popover itself (the grid scrolls) would leave the fixed popover behind. */
  private readonly onScroll = (event: Event): void => {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close(false);
  };

  private walkable(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '.upc-search, .upc-check input[type="checkbox"]',
      ),
    );
  }

  /** Puts the popover under the button, or above it when it does not fit below; if neither side fits it scrolls in the free space. */
  private place(): void {
    const pop = this.popRef()?.nativeElement;
    const button = this.trigger()?.nativeElement;
    if (!pop || !button) return;
    const rect = button.getBoundingClientRect();
    const margin = 8;
    pop.style.maxHeight = 'none';
    const height = pop.getBoundingClientRect().height;
    pop.style.maxHeight = '';
    const roomBelow = window.innerHeight - rect.bottom - 4 - margin;
    const roomAbove = rect.top - 4 - margin;
    const left = this.pos().left;
    if (height <= roomBelow) {
      this.pos.set({ top: rect.bottom + 4, left, maxHeight: null });
    } else if (height <= roomAbove) {
      this.pos.set({ top: rect.top - 4 - height, left, maxHeight: null });
    } else if (roomAbove > roomBelow) {
      const max = Math.max(160, roomAbove);
      this.pos.set({ top: rect.top - 4 - Math.min(height, max), left, maxHeight: max });
    } else {
      this.pos.set({ top: rect.bottom + 4, left, maxHeight: Math.max(160, roomBelow) });
    }
  }
}
