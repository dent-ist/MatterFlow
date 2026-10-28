import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MmFilters, ROLE_LABELS, roleApplies } from './my-matters-filters';

/** One filter that is in force, as a removable chip. */
interface ActiveFilter {
  key: 'client' | 'role' | 'manager';
  /** "Client: Acme Corp". */
  text: string;
  /** What removing it means. */
  patch: Partial<MmFilters>;
}

/**
 * The filters that are in force, as removable chips (issue #899), for a phone: its Filters button is a sheet, so without these a person could not see what
 * the page is filtered by without opening it. One chip per filter ("Client: Acme Corp", "I am: Secondary"), each with a 44 px button that removes it; nothing is
 * drawn when no filter is in force. On a wider screen the controls themselves show their value, so the page draws none there.
 */
@Component({
  selector: 'mf-mm-active-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    :host(:empty) {
      display: none;
    }
    .af {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .af__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      max-width: 100%;
      min-height: 44px;
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong, var(--mf-border));
      border-radius: 999px;
      background: var(--mf-surface-alt);
    }
    .af__text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .af__x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .af__x:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -4px;
      border-radius: 999px;
    }
  `,
  template: `
    @if (items().length > 0) {
      <ul class="af" aria-label="Filters in force" data-active-filters>
        @for (f of items(); track f.key) {
          <li class="af__chip" [attr.data-active-filter]="f.key">
            <span class="af__text">{{ f.text }}</span>
            <button
              type="button"
              class="af__x"
              [attr.aria-label]="'Remove the filter ' + f.text"
              (click)="remove.emit(f.patch)"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class MyMattersActiveFilters {
  readonly filters = input.required<MmFilters>();
  readonly clientName = input<string | null>(null);
  readonly managerName = input<string | null>(null);
  readonly remove = output<Partial<MmFilters>>();

  protected readonly items = computed<ActiveFilter[]>(() => {
    const f = this.filters();
    const out: ActiveFilter[] = [];
    if (f.managerId !== null)
      out.push({
        key: 'manager',
        text: `Project manager: ${this.managerName() ?? f.managerId}`,
        patch: { managerId: null, role: 'both' },
      });
    if (f.clientId !== null)
      out.push({
        key: 'client',
        text: `Client: ${this.clientName() ?? f.clientId}`,
        patch: { clientId: null },
      });
    if (f.role !== 'both' && roleApplies(f))
      out.push({
        key: 'role',
        text: `${f.scope === 'all' ? 'Their role' : 'I am'}: ${ROLE_LABELS[f.role]}`,
        patch: { role: 'both' },
      });
    return out;
  });
}
