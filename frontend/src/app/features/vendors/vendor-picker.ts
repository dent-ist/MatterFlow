import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EmbeddedViewRef,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { VendorLookupItem, VendorsClient } from '../../api/generated/api-client';
import { QuietRequests } from '../../core/http/interceptors';
import { Tip } from '../../shared/ui/tip';
import { VendorCategory } from './vendor-badges';

/** The words of the vendor combobox (D-20): one place, so the specs and the dialogs that use it agree. */
export const VENDOR_PICKER_MESSAGES = {
  /** The dialog shows this under the picker when text is typed but no vendor is picked: free text is never accepted. */
  pick: 'Choose a vendor from the list.',
  failed: "Couldn't search vendors.",
  empty: 'No vendors yet. Vendors are added on the Vendors page.',
  noMatch: (text: string): string =>
    `No vendor matches "${text}". Vendors are added on the Vendors page.`,
} as const;

/**
 * The vendor combobox (epic #1373, issue #1379; mockup `docs/design/mockups/vendor-management`, "Edit Vendors"): type to search the Vendors list (`GET /api/v1/vendors/lookup`: name, website
 * or service, at most 20), pick one. Built like the person combobox (D-37): the list is a floating panel in the body (never clipped by the dialog body), every option is ONE 36 px line (D-36): an icon,
 * the name, the muted services (cut with an ellipsis, the whole line is the tooltip) and the category chip. A Blacklisted vendor is offered like any other, with its red chip; a vendor that is
 * already on the list is shown disabled with `takenLabel`. There is no Create option: vendors are added on the Vendors page. Free text is never a value: only picking a record emits
 * `picked` (the box empties itself, the "always empty row" of the Edit Vendors dialog); `draftChange` tells the dialog when text is typed and nothing is picked.
 *
 * Standard combobox keys only, inside the control: Arrow Down and Arrow Up open and move, Enter picks, Esc closes the list (and leaves a dialog around it open). Nothing is registered as a shortcut (#420).
 */
@Component({
  selector: 'mf-vendor-picker',
  imports: [VendorCategory, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/form-field.scss',
  styles: `
    .vp__field {
      position: relative;
      display: grid;
    }
    .vp__field > .pi {
      position: absolute;
      top: 50%;
      left: var(--mf-s3);
      transform: translateY(-50%);
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-md);
      pointer-events: none;
    }
    .vp__field .mf-field__input {
      padding-left: calc(var(--mf-s3) + var(--mf-icon-md) + var(--mf-s2));
    }
    .vp__panel {
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
    .vp__list {
      flex: 1;
      margin: 0;
      padding: var(--mf-s1);
      overflow: auto;
      list-style: none;
    }
    .vp__note {
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
    }
    .vp__opt {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h);
      box-sizing: border-box;
      padding: var(--mf-s1) var(--mf-s3);
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .vp__opt > .pi {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-md);
    }
    .vp__opt:hover {
      background: var(--mf-surface-alt);
    }
    .vp__opt--active {
      background: var(--mf-selected-bg);
    }
    .vp__opt[aria-disabled='true'] {
      color: var(--mf-text-disabled);
      cursor: not-allowed;
    }
    .vp__opt[aria-disabled='true'] .vp__meta,
    .vp__opt[aria-disabled='true'] > .pi {
      color: var(--mf-text-disabled);
    }
    .vp__opt[aria-disabled='true']:hover {
      background: transparent;
    }
    .vp__grow {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vp__name {
      font-weight: var(--mf-fw-semibold);
    }
    .vp__meta {
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">{{ label() }}</label>
      <div class="vp__field" #box>
        <i class="pi pi-search" aria-hidden="true"></i>
        <input
          class="mf-field__input"
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          [id]="inputId()"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [attr.aria-expanded]="showList()"
          [attr.aria-controls]="showList() ? inputId() + '-list' : null"
          [attr.aria-activedescendant]="activeId()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          [value]="text()"
          (input)="onInput($event)"
          (click)="openList()"
          (keydown)="onKey($event)"
          (blur)="close()"
        />
      </div>
      @if (help()) {
        <p class="mf-field__help" [id]="inputId() + '-help'">{{ help() }}</p>
      }
      @if (error(); as e) {
        <p class="mf-field__error" role="alert" [id]="inputId() + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
        </p>
      }
    </div>

    <ng-template #panelTpl>
      <div
        class="vp__panel"
        data-vendor-panel-list
        [style.left.px]="pos().left"
        [style.top.px]="pos().above ? null : pos().top"
        [style.bottom.px]="pos().above ? pos().bottom : null"
        [style.width.px]="pos().width"
        [style.maxHeight.px]="pos().maxHeight"
      >
        @if (listShown()) {
          <ul
            class="vp__list"
            role="listbox"
            [attr.aria-label]="label()"
            [id]="inputId() + '-list'"
            data-vendor-list
          >
            @for (v of rows(); track v.vendorId; let i = $index) {
              <li
                class="vp__opt"
                role="option"
                [id]="inputId() + '-opt-' + i"
                [class.vp__opt--active]="i === active()"
                [attr.aria-selected]="i === active()"
                [attr.aria-disabled]="taken().includes(v.vendorId) ? 'true' : null"
                [attr.data-vendor-id]="v.vendorId"
                [mfTip]="detail(v)"
                (mousedown)="$event.preventDefault(); choose(v)"
              >
                <i class="pi pi-truck" aria-hidden="true"></i>
                <span class="vp__grow"
                  ><span class="vp__name">{{ v.name }}</span
                  ><span class="vp__meta">{{ v.services.join(', ') }}</span></span
                >
                @if (taken().includes(v.vendorId)) {
                  <span class="vp__meta" data-option-note>{{ takenLabel() }}</span>
                } @else {
                  <mf-vendor-category [category]="v.category" />
                }
              </li>
            }
          </ul>
        } @else {
          <div class="vp__note" role="status" data-vendor-note>{{ note() }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class VendorPicker implements OnDestroy {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly placeholder = input('Search vendors by name, website or service');
  readonly help = input('');
  readonly disabled = input(false);
  readonly error = input<string | null>(null);
  /** Vendors already on the list the picker adds to: shown, disabled, with `takenLabel`. */
  readonly taken = input<readonly number[]>([]);
  readonly takenLabel = input('On the List');
  readonly debounceMs = input(250);

  /** A vendor was picked; the box empties itself. */
  readonly picked = output<VendorLookupItem>();
  /** The text in the box changes: the dialog uses it to refuse a save while text is typed and nothing is picked. */
  readonly draftChange = output<string>();

  private readonly api = inject(VendorsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly vcr = inject(ViewContainerRef);
  private readonly tpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private view: EmbeddedViewRef<unknown> | null = null;
  protected readonly pos = signal({
    left: 0,
    top: 0,
    bottom: 0,
    above: false,
    width: 280,
    maxHeight: 320,
  });

  protected readonly text = signal('');
  protected readonly rows = signal<VendorLookupItem[]>([]);
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly loaded = signal(false);
  protected readonly active = signal(-1);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  /** The listbox is drawn only when it has an option (a note alone is a status message, not a listbox without options). */
  protected readonly listShown = computed(() => !this.failed() && this.rows().length > 0);
  protected readonly showList = computed(() => this.open() && this.listShown());
  protected readonly note = computed(() =>
    this.failed()
      ? VENDOR_PICKER_MESSAGES.failed
      : this.loading() || !this.loaded()
        ? 'Searching...'
        : this.text().trim()
          ? VENDOR_PICKER_MESSAGES.noMatch(this.text().trim())
          : VENDOR_PICKER_MESSAGES.empty,
  );
  protected readonly activeId = computed(() =>
    this.showList() && this.active() >= 0 ? `${this.inputId()}-opt-${this.active()}` : null,
  );
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [this.error() ? `${id}-error` : null, this.help() ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length ? parts.join(' ') : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyPanel());
    effect(() => {
      const wanted = this.open() && !!this.box();
      this.rows();
      this.note();
      untracked(() => (wanted ? this.showPanel() : this.destroyPanel()));
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private showPanel(): void {
    const box = this.box()?.nativeElement;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const view = this.doc.defaultView;
    const vw = view?.innerWidth ?? 1024;
    const vh = view?.innerHeight ?? 768;
    const below = vh - r.bottom - 16;
    const above = r.top - 16;
    const flip = below < 200 && above > below;
    const cap =
      20 * (parseFloat(view?.getComputedStyle(this.doc.documentElement).fontSize ?? '') || 14);
    this.pos.set({
      left: Math.max(8, Math.min(r.left, vw - r.width - 8)),
      top: r.bottom + 4,
      bottom: vh - r.top + 4,
      above: flip,
      width: Math.min(r.width, vw - 16),
      maxHeight: flip ? Math.min(cap, above) : Math.max(120, Math.min(cap, below)),
    });
    if (this.view) {
      this.view.detectChanges();
      return;
    }
    this.view = this.vcr.createEmbeddedView(this.tpl());
    this.view.detectChanges();
    for (const node of this.view.rootNodes) this.doc.body.appendChild(node as Node);
    view?.addEventListener('resize', this.away);
    view?.addEventListener('scroll', this.scrolled, true);
  }

  private destroyPanel(): void {
    if (!this.view) return;
    const view = this.doc.defaultView;
    view?.removeEventListener('resize', this.away);
    view?.removeEventListener('scroll', this.scrolled, true);
    this.view.destroy();
    this.view = null;
  }

  private readonly away = (): void => this.close();
  /** A scroll outside the list moves the field away from it: the list closes (the list's own scroll does not). */
  private readonly scrolled = (e: Event): void => {
    const panel = this.view?.rootNodes.find((n) => n instanceof HTMLElement) as
      HTMLElement | undefined;
    if (!(e.target instanceof Node && panel?.contains(e.target))) this.close();
  };

  /** Tooltip: the whole option line. */
  protected detail(v: VendorLookupItem): string {
    return [v.name, v.services.join(', '), v.hasDoNotHireContact ? 'Do Not Hire contact' : '']
      .filter(Boolean)
      .join(', ');
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.text.set(value);
    this.draftChange.emit(value);
    this.open.set(true);
    this.active.set(-1);
    this.loaded.set(false);
    this.schedule(value);
  }

  protected openList(): void {
    if (this.disabled()) return;
    this.open.set(true);
    if (!this.loaded() && !this.loading()) this.schedule(this.text(), 0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.rows().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open()) {
        this.openList();
        return;
      }
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set(
        this.active() < 0 && step < 0 ? count - 1 : (this.active() + step + count) % count,
      );
    } else if (event.key === 'Enter' && this.open()) {
      event.preventDefault();
      const row = this.rows()[this.active()];
      if (row) this.choose(row);
    } else if (event.key === 'Escape' && this.open()) {
      // The list closes; the dialog around the picker stays open (the form dialog leaves a handled Esc alone).
      event.preventDefault();
      this.close();
    }
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  protected choose(v: VendorLookupItem): void {
    if (this.taken().includes(v.vendorId)) return;
    const hadFocus = this.host.nativeElement.contains(document.activeElement);
    this.close();
    this.rows.set([]);
    this.loaded.set(false);
    this.text.set('');
    this.draftChange.emit('');
    this.picked.emit(v);
    if (hadFocus) {
      setTimeout(() =>
        this.host.nativeElement.querySelector<HTMLElement>(`[id="${this.inputId()}"]`)?.focus(),
      );
    }
  }

  private schedule(query: string, delay = this.debounceMs()): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(query), delay);
  }

  private async run(query: string): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.failed.set(false);
    try {
      const found = await firstValueFrom(
        this.quiet.run(() => this.api.lookupVendors(query.trim() || undefined)),
      );
      if (id !== this.requestId) return;
      this.rows.set(found);
      this.loaded.set(true);
      this.active.set(-1);
    } catch {
      if (id === this.requestId) {
        this.rows.set([]);
        this.failed.set(true);
        this.loaded.set(true);
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
