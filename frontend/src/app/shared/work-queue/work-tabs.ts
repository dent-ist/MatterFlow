import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export interface WorkTab {
  key: string;
  label: string;
  /** Count shown in parentheses; `null` while it is not known yet shows a reserved "(--)", undefined shows none. */
  count?: number | null;
  /** Bold the count while it is above zero (Active, Due soon). Other non-zero counts stay normal weight; zero counts are muted. */
  emphasize?: boolean;
  /** Tooltip: what the tab holds. */
  hint?: string;
}

/**
 * WAI-ARIA tabs for My Work and Pod Work: arrow keys, Home and End move between tabs and select them (automatic activation),
 * only the selected tab is in the tab order. The page renders the matching `role="tabpanel"` with `id="<idPrefix>-panel"`.
 */
@Component({
  selector: 'mf-work-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="tabs"
      role="tablist"
      [attr.aria-label]="label()"
      [class.fade-start]="fadeStart()"
      [class.fade-end]="fadeEnd()"
      (scroll)="measure()"
    >
      @for (tab of tabs(); track tab.key; let i = $index) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="idPrefix() + '-tab-' + tab.key"
          [attr.aria-selected]="tab.key === selected()"
          [attr.aria-controls]="idPrefix() + '-panel'"
          [attr.title]="tab.hint ?? null"
          [tabindex]="tab.key === selected() ? 0 : -1"
          (click)="selectedChange.emit(tab.key)"
          (keydown)="onKey($event, i)"
        >
          {{ tab.label }}
          @if (tab.count === null) {
            <span class="count count--zero" data-count-pending aria-hidden="true">(--)</span>
          } @else if (tab.count !== undefined) {
            <span
              class="count"
              [class.count--strong]="tab.emphasize && tab.count > 0"
              [class.count--zero]="tab.count === 0"
              >({{ tab.count }})</span
            >
          }
        </button>
      }
    </div>
  `,
  styles: `
    /* One row that scrolls sideways on a narrow screen, so every tab keeps the baseline underline (UXR4-19). */
    .tabs {
      display: flex;
      flex-wrap: nowrap;
      gap: var(--mf-s1);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
      /* Keeps the selected tab's 3 px underline (it overlaps the row's border by 2 px) inside the scrolling box. */
      margin-bottom: -2px;
      padding-bottom: 2px;
    }
    /* Edge fades while there is more to scroll to (narrow screens); the selected tab is scrolled into view. */
    .tabs.fade-start {
      mask-image: linear-gradient(to right, transparent 0, #000 var(--mf-s5));
    }
    .tabs.fade-end {
      mask-image: linear-gradient(to left, transparent 0, #000 var(--mf-s5));
    }
    .tabs.fade-start.fade-end {
      mask-image: linear-gradient(
        to right,
        transparent 0,
        #000 var(--mf-s5),
        #000 calc(100% - var(--mf-s5)),
        transparent 100%
      );
    }
    .tab {
      flex: none;
      white-space: nowrap;
      min-height: var(--mf-row-h);
      padding: 0 var(--mf-s4);
      border: 0;
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .tab[aria-selected='true'] {
      border-bottom-color: var(--mf-primary);
      color: var(--mf-primary);
      font-weight: 600;
    }
    /* Digits of one width and room for two of them: the number replaces "(--)" without moving the next tab (G4). */
    .count {
      display: inline-block;
      min-width: 2.4em;
      color: inherit;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }
    .count--zero {
      color: var(--mf-text-muted);
    }
    .count--strong {
      font-weight: 700;
    }
  `,
})
export class WorkTabs {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tabs = input.required<readonly WorkTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Views');
  /** Prefix of the element ids (`<prefix>-tab-<key>`, and the panel `<prefix>-panel`). */
  readonly idPrefix = input('work');
  readonly selectedChange = output<string>();

  protected readonly fadeStart = signal(false);
  protected readonly fadeEnd = signal(false);

  constructor() {
    afterNextRender(() => this.measure());
    effect(() => {
      const key = this.selected();
      this.tabs();
      queueMicrotask(() => this.reveal(key));
    });
  }

  /** Shows the edge fades only while the strip has more to scroll to on that side. */
  protected measure(): void {
    const strip = this.host.nativeElement.querySelector<HTMLElement>('.tabs');
    if (!strip) return;
    this.fadeStart.set(strip.scrollLeft > 1);
    this.fadeEnd.set(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
  }

  private reveal(key: string): void {
    const tab = this.host.nativeElement.querySelector<HTMLElement>(
      `#${this.idPrefix()}-tab-${key}`,
    );
    if (tab && typeof tab.scrollIntoView === 'function') {
      tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
    this.measure();
  }

  protected onKey(event: KeyboardEvent, index: number): void {
    const count = this.tabs().length;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % count
        : event.key === 'ArrowLeft'
          ? (index - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const tab = this.tabs()[next];
    this.selectedChange.emit(tab.key);
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(`#${this.idPrefix()}-tab-${tab.key}`)
        ?.focus(),
    );
  }
}
