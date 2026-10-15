import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

export interface WorkTab {
  key: string;
  label: string;
  /** Count shown in parentheses; omitted while unknown. */
  count?: number | null;
  /** Bold the count while it is above zero (Active, Due soon). Other non-zero counts stay normal weight; zero counts are muted. */
  emphasize?: boolean;
}

/**
 * WAI-ARIA tabs for My Work and Pod Work: arrow keys, Home and End move between tabs and select them (automatic activation),
 * only the selected tab is in the tab order. The page renders the matching `role="tabpanel"` with `id="<idPrefix>-panel"`.
 */
@Component({
  selector: 'mf-work-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.key; let i = $index) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="idPrefix() + '-tab-' + tab.key"
          [attr.aria-selected]="tab.key === selected()"
          [attr.aria-controls]="idPrefix() + '-panel'"
          [tabindex]="tab.key === selected() ? 0 : -1"
          (click)="selectedChange.emit(tab.key)"
          (keydown)="onKey($event, i)"
        >
          {{ tab.label }}
          @if (tab.count !== undefined && tab.count !== null) {
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
      scrollbar-width: thin;
      /* Keeps the selected tab's 3 px underline (it overlaps the row's border by 2 px) inside the scrolling box. */
      margin-bottom: -2px;
      padding-bottom: 2px;
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
    .count {
      color: inherit;
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
