import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { WorkloadUser } from '../../../api/generated/api-client';
import { USER_STATE_WORDS, UserStateKey } from '../../../shared/icons/user-state-icon';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { STATE_KEYS, UsersFilters, stateKeysOf } from './users-model';

/**
 * The ONE State control of the Users Workload view (US-11, #1102), replacing the six state buttons: the shared multi-select dropdown with "All states" on top and one row per state
 * (the state icon, the name and the number of people), any combination. The button says "State: All states" or "State: Idle +1". Choosing "All states" clears the others and choosing a
 * state clears "All states". The counts follow the people on the board (the page scope, the name search and the population rule).
 */
@Component({
  selector: 'mf-users-state',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-dropdown
      buttonId="wl-state"
      label="State"
      prefix="State:"
      data-state-dropdown
      [multi]="true"
      [items]="items()"
      [values]="selected()"
      [panelWidth]="260"
      (valuesChange)="onValues($event)"
    />
  `,
  styles: `
    :host {
      display: inline-block;
      min-width: 12rem;
    }
    mf-dropdown {
      display: block;
    }
  `,
})
export class UsersState {
  readonly users = input<readonly WorkloadUser[]>([]);
  readonly filters = input.required<UsersFilters>();
  readonly statesChange = output<UserStateKey[]>();

  protected readonly items = computed<DropdownItem[]>(() => {
    const users = this.users();
    const counts = new Map<UserStateKey, number>();
    for (const u of users) for (const k of stateKeysOf(u)) counts.set(k, (counts.get(k) ?? 0) + 1);
    return [
      { value: '', label: 'All states', count: users.length },
      ...STATE_KEYS.map((k) => ({
        value: k,
        label: USER_STATE_WORDS[k],
        count: counts.get(k) ?? 0,
        stateIcon: k,
      })),
    ];
  });

  /** "All states" is the chosen row while no state is chosen; the list's own choice is written back so an unchecked row never leaves it empty. */
  protected readonly selected = linkedSignal<readonly string[]>(() => {
    const s = this.filters().states;
    return s.length ? s : [''];
  });

  protected onValues(next: readonly string[]): void {
    const before = this.filters().states;
    // "All states" was just chosen: clear the others. Otherwise the chosen states (a state clears "All states").
    const states =
      next.includes('') && before.length > 0 ? [] : STATE_KEYS.filter((k) => next.includes(k));
    this.selected.set(states.length ? [...states] : ['']);
    this.statesChange.emit([...states]);
  }
}
