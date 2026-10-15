import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

export interface DashTab {
  key: string;
  label: string;
}

/** Ids tie each tab to its panel (`aria-controls`, `aria-labelledby`); the page renders the panel with `panelId`. */
export const tabId = (key: string) => `mf-dash-tab-${key}`;
export const panelId = (key: string) => `mf-dash-panel-${key}`;

/**
 * The tab list of the Dashboard (WAI-ARIA tabs pattern, automatic activation): the selected tab is the only tab stop (roving tabindex),
 * Left and Right arrows move between tabs and wrap round, Home and End jump to the first and last, and moving to a tab selects it. The
 * page owns the selection (it lives in the address, `?tab=`) and renders the matching `role="tabpanel"`. On a narrow screen the list
 * scrolls sideways instead of wrapping.
 */
@Component({
  selector: 'mf-dash-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="label()">
      @for (t of tabs(); track t.key) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="tabId(t.key)"
          [attr.data-tab]="t.key"
          [attr.aria-selected]="t.key === selected()"
          [attr.aria-controls]="t.key === selected() ? panelId(t.key) : null"
          [attr.tabindex]="t.key === selected() ? 0 : -1"
          (click)="choose(t.key)"
          (keydown)="onKey($event)"
        >
          {{ t.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s4);
    }
    .tabs {
      display: flex;
      gap: var(--mf-s1);
      overflow-x: auto;
      border-bottom: 1px solid var(--mf-border);
      scrollbar-width: thin;
    }
    .tab {
      flex: none;
      min-height: 2.75rem;
      margin-bottom: -1px;
      padding: 0 var(--mf-s4);
      color: var(--mf-text-muted);
      background: none;
      border: 0;
      border-bottom: 3px solid transparent;
      font: inherit;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .tab:hover {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
    .tab[aria-selected='true'] {
      color: var(--mf-text);
      font-weight: 600;
      border-bottom-color: var(--mf-primary);
    }
    /* On a phone the three tabs share the width instead of scrolling out of view. */
    @media (max-width: 480px) {
      .tab {
        flex: 1 1 auto;
        padding: 0 var(--mf-s2);
      }
    }
    .tab:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
  `,
})
export class DashTabs {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly tabId = tabId;
  protected readonly panelId = panelId;

  readonly tabs = input.required<readonly DashTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Dashboard views');
  /** The tab the person chose (click or keyboard). */
  readonly tabChange = output<string>();

  protected choose(key: string): void {
    if (key !== this.selected()) this.tabChange.emit(key);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = this.tabs().map((t) => t.key);
    const at = Math.max(0, keys.indexOf(this.selected()));
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
        to = (at + 1) % keys.length;
        break;
      case 'ArrowLeft':
        to = (at - 1 + keys.length) % keys.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = keys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const tab = this.host.nativeElement.querySelector<HTMLElement>(`[data-tab="${keys[to]}"]`);
    tab?.focus();
    // A focused tab that sits past the edge of a scrolling tab list is brought into view.
    tab?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    this.choose(keys[to]);
  }
}
