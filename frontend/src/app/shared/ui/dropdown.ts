import {
  ChangeDetectionStrategy,
  booleanAttribute,
  Component,
  DestroyRef,
  ElementRef,
  EmbeddedViewRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { UserStateIcon, UserStateKey } from '../icons/user-state-icon';
import { TaskTypeChip } from './task-type-chip';
import { IntPipe } from './number-format';

export interface DropdownItem {
  value: string;
  label: string;
  /** Right-aligned count ("Overdue 11"). */
  count?: number | null;
  /** A second line under the label (the client of a matter, what a Shows choice means). */
  sub?: string;
  /** The activity dot of a matter: filled (active) or hollow (quiet); also written for screen readers. */
  dot?: 'active' | 'quiet' | null;
  /** The matter is sensitive: a lock and the word for screen readers. */
  lock?: boolean;
  /** A PrimeIcons class drawn in a small tinted square before the label (the activity kinds), in the colour of `tone`. */
  icon?: string;
  tone?: 'info' | 'accent' | 'neutral' | 'danger' | 'warning';
  /** A type chip (24 px) before the label: the asset types. `kind` is the first words of its accessible name. */
  typeChip?: {
    iconKey?: string | null;
    colourKey?: string | null;
    id?: number | null;
    kind?: string;
  };
  /** The person-state icon (the Users state list): the shape of the state in its colour, before the label. */
  stateIcon?: UserStateKey;
  /** A group heading (not choosable). */
  heading?: boolean;
  /** Shown but not choosable (muted, `aria-disabled`). */
  disabled?: boolean;
}

let nextId = 0;

/**
 * The one dropdown of the app (`mf-dropdown`, epic #953 UI-19): a button that opens a rounded popover list in the mockup's style, a light blue chosen row with a check mark at its right edge (before the count; no reserved left column), counts right-aligned, comfortable rows, and `role="listbox"`. Single choice (`value`) or several (`multi`, `values`, with a Done button). A search box only where the list is
 * long (`search`; matches the label and the second line); `limit` shows the first rows and says "keep typing". Keys: Down or Enter on the button opens it; in the list Up, Down, Home, End,
 * type-ahead, Enter (or Space) choose, Escape closes and returns focus to the button, Tab closes. The popover is drawn in the page's overlay layer (the body), so a frame that clips
 * or contains its children cannot cut it. Rows are 44 px on a phone. Colours are tokens only; the button is 36 px (`sm` 32 px, 44 px on a phone), 4 px radius, as wide as its widest option (22 rem at most); the list is 8 px radius, items 36 px, selected = check and 600 weight on `--mf-selected-bg`, a search box above ten options, "No matches." when empty; the multi list has a checkbox per item and its "All" row (empty value) clears the rest.
 */
@Component({
  selector: 'mf-dropdown',
  imports: [IntPipe, TaskTypeChip, UserStateIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      #btn
      class="btn"
      [class.on]="highlighted() && !field()"
      [class.sm]="size() === 'sm'"
      [id]="buttonId() || id"
      [disabled]="disabled()"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.data-value]="multi() ? null : value()"
      [attr.aria-describedby]="describedBy() || null"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [attr.aria-label]="label() + ': ' + (text() || '')"
      (click)="toggle()"
      (keydown)="onButtonKey($event)"
    >
      @if (chosen()?.stateIcon; as si) {
        <mf-user-state-icon [state]="si" />
      } @else if (chosen()?.typeChip; as tc) {
        <mf-task-type-chip
          size="sm"
          [decorative]="true"
          [iconKey]="tc.iconKey"
          [colourKey]="tc.colourKey"
          [typeId]="tc.id"
          [name]="chosen()!.label"
        />
      } @else if (chosen()?.icon; as ci) {
        <span class="ki" [attr.data-tone]="chosen()?.tone" aria-hidden="true"
          ><i class="pi" [class]="ci"></i
        ></span>
      } @else if (icon()) {
        <i class="pi ico" [class]="icon()" aria-hidden="true"></i>
      }
      @if (prefix()) {
        <span class="pre">{{ prefix() }}</span>
      }
      <span class="vw">
        <span class="val" [attr.title]="text() || null">{{ text() }}</span>
        @for (w of sizer(); track $index) {
          <span class="siz" aria-hidden="true" [attr.data-w]="w"></span>
        }
      </span>
      @if (buttonCount() !== null) {
        <span class="cnt">({{ buttonCount() | mfInt }})</span>
      }
      <i class="pi pi-chevron-down chev" aria-hidden="true"></i>
    </button>

    <ng-template #panelTpl>
      <div
        class="dd-panel"
        [style.left.px]="pos().left"
        [style.top.px]="pos().above ? null : pos().top"
        [style.bottom.px]="pos().above ? pos().bottom : null"
        [style.width.px]="pos().width"
        [style.maxHeight.px]="pos().maxHeight"
      >
        @if (hasSearch()) {
          <div class="srch">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              type="text"
              role="combobox"
              aria-expanded="true"
              [attr.aria-controls]="id + '-list'"
              [attr.aria-label]="searchLabel()"
              [placeholder]="searchLabel()"
              autocomplete="off"
              [value]="query()"
              (input)="onSearch($any($event.target).value)"
            />
          </div>
        }
        <ul
          class="list"
          role="listbox"
          [id]="id + '-list'"
          tabindex="0"
          [attr.aria-label]="label()"
          [attr.aria-multiselectable]="multi() ? true : null"
        >
          @for (it of shown(); track $index) {
            @if (it.heading) {
              <li role="presentation" class="gh">{{ it.label }}</li>
            } @else {
              <li
                role="option"
                tabindex="-1"
                [attr.data-value]="it.value"
                [attr.aria-selected]="isOn(it.value)"
                [attr.aria-disabled]="it.disabled ? 'true' : null"
                [class.on]="isOn(it.value)"
              >
                @if (multi()) {
                  <span class="cb" [class.on]="isOn(it.value)" aria-hidden="true"
                    ><i class="pi pi-check"></i
                  ></span>
                }
                @if (it.typeChip; as tc) {
                  <mf-task-type-chip
                    size="sm"
                    [decorative]="true"
                    [iconKey]="tc.iconKey"
                    [colourKey]="tc.colourKey"
                    [typeId]="tc.id"
                    [name]="it.label"
                  />
                }
                @if (it.stateIcon) {
                  <mf-user-state-icon [state]="it.stateIcon" [circle]="true" />
                } @else if (it.icon) {
                  <span class="ki" [attr.data-tone]="it.tone" aria-hidden="true"
                    ><i class="pi" [class]="it.icon"></i
                  ></span>
                } @else if (hasIcons() && !it.typeChip && !it.dot && it.value === '') {
                  <span class="ki" data-tone="neutral" aria-hidden="true"
                    ><i class="pi pi-list"></i
                  ></span>
                }
                @if (it.dot) {
                  <span class="dot" [class.quiet]="it.dot === 'quiet'" aria-hidden="true"></span>
                  <span class="sr">{{ it.dot === 'active' ? 'Active. ' : 'Quiet. ' }}</span>
                }
                <span class="t"
                  >{{ it.label }}
                  @if (it.lock) {
                    <i class="pi pi-lock lock" aria-hidden="true"></i
                    ><span class="sr"> Sensitive matter</span>
                  }
                  @if (it.sub) {
                    <small>{{ it.sub }}</small>
                  }
                </span>
                @if (isOn(it.value) && !multi()) {
                  <i class="pi pi-check tick" aria-hidden="true"></i>
                }
                @if ((it.count ?? -1) >= 0) {
                  <span class="n">{{ it.count | mfInt }}</span>
                }
              </li>
            }
          }
          @if (more() > 0) {
            <li role="presentation" class="mute">{{ more() }} more - keep typing to narrow</li>
          }
          @if (none()) {
            <!-- A listbox needs at least one option; this one cannot be chosen (the key and click handlers skip it). -->
            <li role="option" aria-disabled="true" aria-selected="false" class="mute">
              No matches.
            </li>
          }
        </ul>
        @if (multi()) {
          <div class="foot">
            <span>Pick any combination</span>
            <button type="button" data-dd-done (click)="close(true)">Done</button>
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-block;
      min-width: 0;
      max-width: 100%;
    }
    .btn {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: var(--mf-ctl-h);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      max-width: 22rem;
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    /* 36 px in a toolbar or a form; 32 px only in a table cell, or where a filter row asks for it with size="sm" (D-02, #1215). */
    .btn.sm,
    :host-context(td) .btn {
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      height: var(--mf-ctl-h-sm);
      font-size: var(--mf-fs-sm);
    }
    .btn:hover {
      background: var(--mf-surface-alt);
    }
    .btn[aria-expanded='true'] {
      border-color: var(--mf-primary);
      box-shadow: 0 0 0 3px var(--mf-sem-info-bg);
    }
    .btn.on {
      background: var(--mf-sem-info-bg);
      border-color: var(--mf-sem-info-line);
    }
    .btn[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
    .btn:disabled {
      background: var(--mf-surface-alt);
      color: var(--mf-text-disabled);
      cursor: not-allowed;
    }
    .pre,
    .cnt {
      font-variant-numeric: tabular-nums;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      flex: none;
    }
    /* The trigger is as wide as its widest option and never changes with the chosen value (#1125): the longest labels are drawn invisibly in the same grid cell. */
    .vw {
      display: grid;
      flex: 1 1 auto;
      min-width: 0;
    }
    .vw > * {
      grid-area: 1 / 1;
    }
    .siz::after {
      content: attr(data-w);
    }
    .siz {
      overflow: hidden;
      height: 0;
      visibility: hidden;
      font-weight: 600;
      white-space: nowrap;
    }
    .val {
      min-width: 0;
      overflow: hidden;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .chev,
    .ico {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-sm);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .dd-panel {
      position: fixed;
      z-index: 3000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-pop);
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
    }
    .srch {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
    }
    .srch input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
    }
    .srch:focus-within {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .list {
      flex: 1;
      margin: 0;
      padding: var(--mf-s1);
      overflow: auto;
      list-style: none;
    }
    .list li[role='option'] {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s1) var(--mf-s3);
      min-height: var(--mf-row-h);
      box-sizing: border-box;
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .list li[role='option']:hover,
    .list li[role='option']:focus {
      background: var(--mf-surface-alt);
      outline: 0;
    }
    .list li[role='option']:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .list li.on {
      background: var(--mf-selected-bg);
      font-weight: 600;
    }
    .cb {
      display: grid;
      flex: none;
      place-items: center;
      box-sizing: border-box;
      width: var(--mf-icon-sm);
      height: var(--mf-icon-sm);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: transparent;
      font-size: var(--mf-icon-xs);
    }
    .cb.on {
      border-color: var(--mf-primary);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast);
    }
    .t {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    small {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .n {
      color: var(--mf-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .tick {
      flex: none;
      color: var(--mf-primary);
      font-size: var(--mf-icon-sm);
    }
    .dot {
      flex: none;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--mf-active);
    }
    .dot.quiet {
      background: transparent;
      border: 2px solid var(--mf-text-muted);
      box-sizing: border-box;
    }
    .lock {
      margin-left: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .ki {
      display: grid;
      flex: none;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: var(--mf-radius-lg);
      background: var(--k-bg);
      color: var(--k-fg);
      font-size: var(--mf-fs-sm);
    }
    .ki[data-tone='info'] {
      --k-bg: var(--mf-sem-info-bg);
      --k-fg: var(--mf-sem-info-fg);
    }
    .ki[data-tone='accent'] {
      --k-bg: var(--mf-status-progress-bg);
      --k-fg: var(--mf-status-progress-fg);
    }
    .ki[data-tone='neutral'] {
      --k-bg: var(--mf-surface-alt);
      --k-fg: var(--mf-text-muted);
    }
    .ki[data-tone='danger'] {
      --k-bg: var(--mf-sem-overdue-bg);
      --k-fg: var(--mf-sem-overdue-fg);
    }
    .ki[data-tone='warning'] {
      --k-bg: var(--mf-sem-risk-bg);
      --k-fg: var(--mf-sem-risk-fg);
    }
    .btn .ki {
      width: 20px;
      height: 20px;
      font-size: var(--mf-fs-xs);
    }
    .gh {
      padding: var(--mf-s2) var(--mf-s3) var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .mute,
    .list li[role='option'].mute {
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
      cursor: default;
    }
    .list li[role='option'][aria-disabled='true']:not(.mute) {
      color: var(--mf-text-disabled);
      cursor: not-allowed;
    }
    .list li[role='option'].mute:hover {
      background: transparent;
    }
    .foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--mf-s2) var(--mf-s3);
      border-top: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .foot button {
      min-height: var(--mf-ctl-h-sm);
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }
    @media (max-width: 767.98px) {
      .btn,
      .btn.sm,
      :host-context(td) .btn {
        height: 44px;
      }
      .list li[role='option'] {
        min-height: 44px;
      }
    }
  `,
})
export class Dropdown {
  private readonly doc = inject(DOCUMENT);
  private readonly vcr = inject(ViewContainerRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly tpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');
  protected readonly id = `mf-dd-${nextId++}`;

  /** The id of the button (a spec or a label can point at it); a generated one when empty. */
  readonly buttonId = input('');
  readonly items = input.required<readonly DropdownItem[]>();
  /** The chosen value (single choice); '' is a value like any other (the "All" row). */
  readonly value = model<string>('');
  /** The chosen values (multi). */
  readonly values = model<readonly string[]>([]);
  readonly multi = input(false);
  /** The accessible name of the control and of the list ("Show", "Client"). */
  readonly label = input.required<string>();
  /** Small text before the value on the button ("Show:"). */
  readonly prefix = input('');
  /** What the button says when nothing is chosen, or for a multi choice (it says how many). */
  readonly placeholder = input('Choose');
  readonly icon = input('');
  readonly search = input(false);
  readonly searchLabel = input('Search');
  /** Rows drawn before "keep typing"; 0 draws all of them. */
  readonly limit = input(0);
  readonly panelWidth = input(280);
  /** Draw the chosen row's count after its name on the button ("Everything (441)"). */
  readonly countOnButton = input(false);
  /** The button looks chosen (a light blue fill) when a value other than `neutralValue` is chosen. */
  readonly neutralValue = input<string | null>('');
  readonly size = input<'md' | 'sm'>('md');
  /** A form field (D-44r): inside a form, dialog or record page the value is an answer, not a filter, so the button is a white field with or without a value. The blue fill is for filter rows, popovers and toolbars only. */
  readonly field = input(false, { transform: booleanAttribute });
  readonly disabled = input(false);
  /** The id of a note that describes the control (read after its name). */
  readonly describedBy = input<string | null>(null);
  /** The field failed validation: danger border and `aria-invalid` on the button. */
  readonly invalid = input(false);

  protected readonly open = signal(false);
  protected readonly query = signal('');
  /** The text typed in the search box (a page that looks values up on the server reloads its items from it). */
  readonly searched = output<string>();
  protected onSearch(text: string): void {
    this.query.set(text);
    this.searched.emit(text);
  }
  protected readonly pos = signal({
    left: 0,
    top: 0,
    bottom: 0,
    above: false,
    width: 280,
    maxHeight: 360,
  });
  private view: EmbeddedViewRef<unknown> | null = null;
  private typed = '';
  private typedAt = 0;

  protected readonly chosen = computed(
    () => this.items().find((i) => !i.heading && i.value === this.value()) ?? null,
  );
  protected readonly text = computed(() => {
    if (this.multi()) {
      const n = this.values().length;
      return n === 0
        ? this.placeholder()
        : n === 1
          ? (this.items().find((i) => i.value === this.values()[0])?.label ?? this.placeholder())
          : `${this.items().find((i) => i.value === this.values()[0])?.label ?? ''} +${n - 1}`;
    }
    return this.chosen()?.label ?? this.placeholder();
  });
  protected readonly buttonCount = computed(() =>
    this.countOnButton() && !this.multi() && (this.chosen()?.count ?? -1) >= 0
      ? this.chosen()!.count!
      : null,
  );
  /** A search box is drawn when asked for, and always above ten options (#1125). */
  protected readonly hasSearch = computed(
    () => this.search() || this.items().filter((i) => !i.heading).length > 10,
  );
  /** The longest labels (and the placeholder), drawn invisibly so the trigger is as wide as its widest text (#1125). */
  protected readonly sizer = computed(() => {
    const labels = this.items()
      .filter((i) => !i.heading)
      .map((i) => i.label)
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);
    const extra = this.multi() ? ' +9' : '';
    return [this.placeholder(), ...labels].map((t) => t + extra);
  });
  protected readonly highlighted = computed(() =>
    this.multi()
      ? this.values().some((v) => v !== this.neutralValue())
      : this.neutralValue() !== null && this.value() !== this.neutralValue(),
  );

  private readonly matching = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items().filter((i) =>
      i.heading ? !q : !q || `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(q),
    );
  });
  private readonly cut = computed(() => {
    const lim = this.limit();
    const all = this.matching();
    if (!lim) return { rows: all, more: 0 };
    let n = 0;
    const rows = all.filter((i) => i.heading || ++n <= lim);
    return { rows, more: Math.max(0, all.filter((i) => !i.heading).length - lim) };
  });
  protected readonly shown = computed(() => this.cut().rows);
  protected readonly more = computed(() => this.cut().more);
  protected readonly none = computed(() => this.matching().filter((i) => !i.heading).length === 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyView());
  }

  /** Some row has an icon or type chip, so the "All ..." row gets a list icon and the left edges line up. */
  protected readonly hasIcons = computed(() =>
    this.items().some((i) => !i.heading && (i.icon || i.typeChip || i.stateIcon)),
  );

  protected isOn(v: string): boolean {
    if (this.multi()) return v === '' ? this.values().length === 0 : this.values().includes(v);
    return this.value() === v;
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.openPanel();
  }

  private openPanel(): void {
    const r = this.btn().nativeElement.getBoundingClientRect();
    const vw = this.doc.defaultView?.innerWidth ?? 1024;
    const vh = this.doc.defaultView?.innerHeight ?? 768;
    const width = Math.min(Math.max(r.width, this.panelWidth()), vw - 16);
    // Below the button; above it when the list needs more room than is left below (a pager at the bottom of a page).
    const below = vh - r.bottom - 16;
    const above = r.top - 16;
    const flip = below < 260 && above > below;
    // The list is at most 20 rem tall, then it scrolls.
    const cap =
      20 *
      (parseFloat(
        this.doc.defaultView?.getComputedStyle(this.doc.documentElement).fontSize ?? '',
      ) || 14);
    this.pos.set({
      left: Math.max(8, Math.min(r.left, vw - width - 8)),
      top: r.bottom + 4,
      bottom: vh - r.top + 4,
      above: flip,
      width,
      maxHeight: flip ? Math.min(cap, above) : Math.max(160, Math.min(cap, below)),
    });
    if (this.query() !== '') this.searched.emit('');
    this.query.set('');
    this.view = this.vcr.createEmbeddedView(this.tpl());
    this.view.detectChanges();
    for (const node of this.view.rootNodes) this.doc.body.appendChild(node as Node);
    this.open.set(true);
    const root = this.panel();
    root?.addEventListener('keydown', (e) => this.onPanelKey(e as KeyboardEvent));
    root?.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>(
        'li[role=option]:not([aria-disabled=true])',
      );
      if (li) this.pick(li.dataset['value'] ?? '');
    });
    this.doc.addEventListener('mousedown', this.outside, true);
    this.doc.defaultView?.addEventListener('resize', this.onResize);
    queueMicrotask(() => {
      const panel = this.panel();
      (
        panel?.querySelector<HTMLElement>('input') ??
        panel?.querySelector<HTMLElement>('li.on') ??
        panel?.querySelector<HTMLElement>('li[role=option]:not([aria-disabled=true])')
      )?.focus();
    });
  }

  private panel(): HTMLElement | null {
    const n = this.view?.rootNodes.find((x) => x instanceof HTMLElement) as HTMLElement | undefined;
    return n ?? null;
  }

  private readonly outside = (e: Event): void => {
    const t = e.target as Node;
    if (this.panel()?.contains(t) || this.host.contains(t)) return;
    this.close(false);
  };
  private readonly onResize = (): void => this.close(false);

  close(restore: boolean): void {
    if (!this.open()) return;
    this.destroyView();
    this.open.set(false);
    if (restore) this.btn().nativeElement.focus();
  }

  private destroyView(): void {
    this.doc.removeEventListener('mousedown', this.outside, true);
    this.doc.defaultView?.removeEventListener('resize', this.onResize);
    if (this.view) {
      for (const node of this.view.rootNodes) (node as ChildNode).remove?.();
      this.view.destroy();
      this.view = null;
    }
  }

  protected pick(v: string): void {
    if (this.multi()) {
      const cur = this.values();
      // "All <things>" (the empty value) clears the rest.
      if (v === '') {
        this.values.set([]);
        this.view?.detectChanges();
        return;
      }
      this.values.set(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
      this.view?.detectChanges();
      return;
    }
    this.value.set(v);
    this.close(true);
  }

  protected onButtonKey(e: KeyboardEvent): void {
    if (!this.open() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.openPanel();
    }
  }

  private onPanelKey(e: KeyboardEvent): void {
    const panel = this.panel();
    if (!panel) return;
    const opts = Array.from(
      panel.querySelectorAll<HTMLElement>('li[role=option]:not([aria-disabled=true])'),
    );
    const inInput = (e.target as HTMLElement).tagName === 'INPUT';
    const at = opts.indexOf(this.doc.activeElement as HTMLElement);
    const go = (i: number): void => {
      e.preventDefault();
      opts[Math.max(0, Math.min(opts.length - 1, i))]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return go(inInput ? 0 : at + 1);
      case 'ArrowUp':
        if (at <= 0 && this.hasSearch()) {
          e.preventDefault();
          panel.querySelector<HTMLElement>('input')?.focus();
          return;
        }
        return go(at - 1);
      case 'Home':
        if (!inInput) go(0);
        return;
      case 'End':
        if (!inInput) go(opts.length - 1);
        return;
      case 'Enter':
      case ' ':
        if (inInput) {
          if (e.key === 'Enter' && opts[0]) {
            e.preventDefault();
            this.pick(opts[0].dataset['value'] ?? '');
          }
          return;
        }
        if (at >= 0) {
          e.preventDefault();
          this.pick(opts[at].dataset['value'] ?? '');
        }
        return;
      case 'Escape':
        e.preventDefault();
        this.close(true);
        return;
      case 'Tab':
        this.close(false);
        return;
      default:
        if (
          !inInput &&
          e.key.length === 1 &&
          /\S/.test(e.key) &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          const now = Date.now();
          this.typed =
            now - this.typedAt > 700 ? e.key.toLowerCase() : this.typed + e.key.toLowerCase();
          this.typedAt = now;
          const labels = opts.map((o) =>
            (o.querySelector('.t')?.textContent ?? '').trim().toLowerCase(),
          );
          const hit =
            labels.findIndex((l, i) => i > at && l.startsWith(this.typed)) >= 0
              ? labels.findIndex((l, i) => i > at && l.startsWith(this.typed))
              : labels.findIndex((l) => l.startsWith(this.typed));
          if (hit >= 0) go(hit);
        }
    }
  }
}
