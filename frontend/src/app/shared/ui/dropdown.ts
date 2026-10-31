import {
  ChangeDetectionStrategy,
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
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

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
  /** A group heading (not choosable). */
  heading?: boolean;
}

let nextId = 0;

/**
 * The one dropdown of the app (`mf-dropdown`, epic #953 UI-19): a button that opens a rounded popover list in the mockup's style, a check mark on the chosen row, a light blue chosen
 * row, counts right-aligned, comfortable rows, and `role="listbox"`. Single choice (`value`) or several (`multi`, `values`, with a Done button). A search box only where the list is
 * long (`search`; matches the label and the second line); `limit` shows the first rows and says "keep typing". Keys: Down or Enter on the button opens it; in the list Up, Down, Home, End,
 * type-ahead, Enter (or Space) choose, Escape closes and returns focus to the button, Tab closes. The popover is drawn in the page's overlay layer (the body), so a frame that clips
 * or contains its children cannot cut it. Rows are 44 px on a phone. Colours are tokens only; the button is 36 px (`sm` 30 px, 44 px on a phone).
 */
@Component({
  selector: 'mf-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      #btn
      class="btn"
      [class.on]="highlighted()"
      [class.sm]="size() === 'sm'"
      [id]="buttonId() || id"
      [disabled]="disabled()"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label() + ': ' + (text() || '')"
      (click)="toggle()"
      (keydown)="onButtonKey($event)"
    >
      @if (chosen()?.icon; as ci) {
        <span class="ki" [attr.data-tone]="chosen()?.tone" aria-hidden="true"
          ><i class="pi" [class]="ci"></i
        ></span>
      } @else if (icon()) {
        <i class="pi ico" [class]="icon()" aria-hidden="true"></i>
      }
      @if (prefix()) {
        <span class="pre">{{ prefix() }}</span>
      }
      <span class="val">{{ text() }}</span>
      @if (buttonCount() !== null) {
        <span class="cnt">({{ buttonCount() }})</span>
      }
      <i class="pi pi-angle-down chev" aria-hidden="true"></i>
    </button>

    <ng-template #panelTpl>
      <div
        class="dd-panel"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        [style.width.px]="pos().width"
        [style.maxHeight.px]="pos().maxHeight"
      >
        @if (search()) {
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
              (input)="query.set($any($event.target).value)"
            />
          </div>
        }
        <ul
          class="list"
          role="listbox"
          [id]="id + '-list'"
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
                [class.on]="isOn(it.value)"
              >
                @if (multi()) {
                  <span class="ck" aria-hidden="true">
                    @if (isOn(it.value)) {
                      <i class="pi pi-check"></i>
                    }
                  </span>
                } @else {
                  <span class="tick" aria-hidden="true">
                    @if (isOn(it.value)) {
                      <i class="pi pi-check"></i>
                    }
                  </span>
                }
                @if (it.icon) {
                  <span class="ki" [attr.data-tone]="it.tone" aria-hidden="true"
                    ><i class="pi" [class]="it.icon"></i
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
                @if ((it.count ?? -1) >= 0) {
                  <span class="n">{{ it.count }}</span>
                }
              </li>
            }
          }
          @if (more() > 0) {
            <li role="presentation" class="mute">{{ more() }} more - keep typing to narrow</li>
          }
          @if (none()) {
            <li role="presentation" class="mute">No match</li>
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
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .btn.sm {
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
    .btn:disabled {
      background: var(--mf-surface-alt);
      cursor: default;
    }
    .pre,
    .cnt {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      flex: none;
    }
    .val {
      flex: 1 1 auto;
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
      font-size: var(--mf-fs-sm);
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
      z-index: 1100;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
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
      padding: 6px;
      overflow: auto;
      list-style: none;
    }
    .list li[role='option'] {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      min-height: 40px;
      box-sizing: border-box;
      border-radius: var(--mf-radius-md);
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
      background: var(--mf-sem-info-bg);
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
      width: 18px;
      color: var(--mf-primary);
    }
    .ck {
      display: grid;
      place-items: center;
      flex: none;
      width: 18px;
      height: 18px;
      box-sizing: border-box;
      border: 1.5px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      color: var(--mf-primary-contrast);
      font-size: 10px;
    }
    li.on .ck {
      background: var(--mf-primary);
      border-color: var(--mf-primary);
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
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .mute {
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
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
      min-height: 32px;
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
      .btn.sm {
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
  readonly disabled = input(false);

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly pos = signal({ left: 0, top: 0, width: 280, maxHeight: 360 });
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
  protected readonly highlighted = computed(() =>
    this.multi()
      ? this.values().length > 0
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

  protected isOn(v: string): boolean {
    return this.multi() ? this.values().includes(v) : this.value() === v;
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
    this.pos.set({
      left: Math.max(8, Math.min(r.left, vw - width - 8)),
      top: r.bottom + 4,
      width,
      maxHeight: Math.max(220, Math.min(420, vh - r.bottom - 16)),
    });
    this.query.set('');
    this.view = this.vcr.createEmbeddedView(this.tpl());
    this.view.detectChanges();
    for (const node of this.view.rootNodes) this.doc.body.appendChild(node as Node);
    this.open.set(true);
    const root = this.panel();
    root?.addEventListener('keydown', (e) => this.onPanelKey(e as KeyboardEvent));
    root?.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[role=option]');
      if (li) this.pick(li.dataset['value'] ?? '');
    });
    this.doc.addEventListener('mousedown', this.outside, true);
    this.doc.defaultView?.addEventListener('resize', this.onResize);
    queueMicrotask(() => {
      const panel = this.panel();
      (
        panel?.querySelector<HTMLElement>('input') ??
        panel?.querySelector<HTMLElement>('li.on') ??
        panel?.querySelector<HTMLElement>('li[role=option]')
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
    const opts = Array.from(panel.querySelectorAll<HTMLElement>('li[role=option]'));
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
        if (at <= 0 && this.search()) {
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
