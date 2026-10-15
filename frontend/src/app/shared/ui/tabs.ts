import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

export interface MfTab {
  key: string;
  label: string;
  /** Count shown in parentheses; omitted while unknown. */
  count?: number | null;
}

/**
 * The shared tab list (WAI-ARIA tabs pattern, automatic activation): the selected tab is the only tab stop (roving tabindex), Left
 * and Right move between tabs and wrap round, Home and End jump to the first and last, and moving to a tab selects it. The page owns
 * the selection (usually in the address) and renders the matching `role="tabpanel"` with `id="<idPrefix>-panel"` and
 * `aria-labelledby="<idPrefix>-tab-<key>"`. On a narrow screen the list scrolls sideways instead of wrapping.
 */
@Component({
  selector: 'mf-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" [attr.aria-label]="label()">
      @for (t of tabs(); track t.key) {
        <button
          type="button"
          role="tab"
          class="tab"
          [id]="idPrefix() + '-tab-' + t.key"
          [attr.data-tab]="t.key"
          [attr.aria-selected]="t.key === selected()"
          [attr.aria-controls]="t.key === selected() ? idPrefix() + '-panel' : null"
          [attr.tabindex]="t.key === selected() ? 0 : -1"
          (click)="choose(t.key)"
          (keydown)="onKey($event)"
        >
          {{ t.label }}
          @if (t.count !== undefined && t.count !== null) {
            <span class="count">({{ t.count }})</span>
          }
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
    .tab:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .count {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
  `,
})
export class Tabs {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tabs = input.required<readonly MfTab[]>();
  readonly selected = input.required<string>();
  readonly label = input('Views');
  /** Prefix of the element ids (`<prefix>-tab-<key>`; the page's panel is `<prefix>-panel`). */
  readonly idPrefix = input('mf');
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
    this.host.nativeElement.querySelector<HTMLElement>(`[data-tab="${keys[to]}"]`)?.focus();
    this.choose(keys[to]);
  }
}
