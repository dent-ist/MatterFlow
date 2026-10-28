import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  ClientsClient,
  MatterManagerItem,
  MatterManagersClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { QuietRequests } from '../../core/http/interceptors';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EntityPicker, PickerOption } from '../../shared/ui/entity-picker';
import { phoneCards } from '../../shared/ui/record-card-list';
import { ManagedMatters } from './managed-matters';
import { MmFilters, MmRole, ROLE_LABELS, roleApplies } from './my-matters-filters';

const managerOption = (m: MatterManagerItem): PickerOption => ({
  id: m.userId,
  label: m.displayName,
});

const clientOption = (c: {
  clientId: number;
  clientNumber: string;
  name: string;
}): PickerOption => ({
  id: c.clientId,
  label: `${c.clientNumber} ${c.name}`,
});

/**
 * The filters of My Matters (README 6.8): Client (a typeahead; only with Client.View), Role (Both, Primary, Secondary) and, in the All matters scope,
 * a Project manager. The page keeps them in the address; this bar only reports a change. "No project manager" is not a filter here: a matter
 * without a manager is normal, never a thing to look for.
 *
 * A control is drawn only when it can change the result (issue #906): Client when the person's matters belong to two or more clients, Role when
 * they are Primary on some and Secondary on others. With neither the bar is not drawn at all (0 px). A filter that is in force (the address, or
 * what was remembered) always keeps its control, so the page is never filtered by something the person cannot see or clear. The bar is the same
 * on every tab: the date range of the Deadlines tab is a control of that tab (`MmDatesControl`), not of this bar.
 */
@Component({
  selector: 'mf-mm-filter-bar',
  imports: [ConfirmDialog, EntityPicker, NgTemplateOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    /* One height for every control of the row: the compact control height of the list filter bars (--mf-row-h-compact, 32 px; 44 px touch
       targets on a phone). The Client / Project manager picker is a shared component whose input takes its height from --mf-row-h, so
       the row sets that token for its own subtree instead of a pixel value. The pointer and the touch target are one rule, so the row
       can never mix heights again (#824). */
    .fb {
      --mf-fb-h: var(--mf-row-h-compact);
      --mf-row-h: var(--mf-fb-h);
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s3) var(--mf-s4);
      margin: 0 0 var(--mf-s2);
    }
    .fb__field {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .fb__field label,
    .fb__label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .fb__client {
      width: min(20rem, 100%);
    }
    .fb__select {
      min-width: 9rem;
      max-width: 22rem;
    }
    .fb__link {
      align-self: center;
      color: var(--mf-link);
    }
    @media (max-width: 639.98px) {
      .fb__link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
    }
    .fb .mf-btn,
    .fb select,
    .fb input {
      box-sizing: border-box;
      height: var(--mf-fb-h);
      min-height: var(--mf-fb-h);
    }
    .fb--phone {
      margin-bottom: var(--mf-s2);
    }
    /* Wide screens (issue #903): the label sits beside its control, so the bar is one 32 px row instead of a 53 px one. The label's wording and style are
       #899's; a phone keeps the stacked fields of its Filters sheet. */
    @media (min-width: 640px) {
      .fb {
        align-items: center;
      }
      .fb__field {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
      }
      :host ::ng-deep .fb__client .mf-field {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
      }
      :host ::ng-deep .fb__client .mf-field > :not(label) {
        flex: 1 1 auto;
        min-width: 0;
      }
      :host ::ng-deep .fb__client .mf-field__label {
        margin: 0;
        white-space: nowrap;
      }
    }
    @media (max-width: 639.98px) {
      .fb {
        --mf-fb-h: 44px;
      }
      .fb__field,
      .fb__client,
      .fb__select {
        width: 100%;
        max-width: none;
      }
    }
  `,
  template: `
    @if (phone()) {
      <div class="fb fb--phone">
        @if (drawn()) {
          <button
            type="button"
            class="mf-btn"
            data-filters-open
            aria-haspopup="dialog"
            (click)="sheet.set(true)"
          >
            <i class="pi pi-filter" aria-hidden="true"></i>
            Filters{{ active() > 0 ? ' (' + active() + ')' : '' }}
          </button>
        }
        <!-- Focus sits beside Filters on a phone: its own row would push Needs my attention out of the first screen (PV-08). -->
        <ng-content select="[mfPhoneRowExtra]" />
      </div>
      @if (drawn()) {
        <mf-confirm-dialog
          title="Filters"
          cancelLabel="Show results"
          [showConfirm]="false"
          [(visible)]="sheet"
        >
          <ng-container *ngTemplateOutlet="controls" />
        </mf-confirm-dialog>
      }
    } @else if (drawn()) {
      <ng-container *ngTemplateOutlet="controls" />
    }
    <ng-template #controls>
      <div class="fb" data-mm-filters>
        @if (showClient()) {
          <div class="fb__field fb__client">
            <mf-entity-picker
              label="Client"
              inputId="mm-client"
              placeholder="All clients"
              [search]="searchClients"
              [selected]="client()"
              (selectedChange)="clientPicked($event)"
            />
          </div>
        }
        @if (filters().scope === 'all') {
          <div class="fb__field fb__client">
            <mf-entity-picker
              label="Project manager"
              inputId="mm-manager"
              placeholder="All project managers"
              [search]="searchManagers"
              [selected]="manager()"
              (selectedChange)="managerPicked($event)"
            />
          </div>
        }
        @if (showRole()) {
          <div class="fb__field">
            <label for="mm-role">Role</label>
            <select
              id="mm-role"
              class="mf-control mf-control--compact fb__select"
              data-filter="role"
              [value]="filters().role"
              (change)="filterChange.emit({ role: $any($event.target).value })"
            >
              @for (r of roles; track r) {
                <option [value]="r" [selected]="r === filters().role">{{ roleLabels[r] }}</option>
              }
            </select>
          </div>
        }
        @if (filters().scope === 'all') {
          <a
            class="fb__link"
            data-set-managers
            routerLink="/matters"
            [queryParams]="{ isActive: 'true' }"
            [state]="{ selectManagers: true }"
            >Set project managers</a
          >
        }
        @if (active() > 0) {
          <button type="button" class="mf-btn" data-clear-filters (click)="clear.emit()">
            Clear filters
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class MyMattersFilterBar {
  readonly filters = input.required<MmFilters>();
  /** How many of this bar's filters are in force (Clear filters shows from 1). */
  readonly active = input(0);
  readonly filterChange = output<Partial<MmFilters>>();
  readonly clear = output<void>();
  /** The name of the chosen client / manager, reported so the strip can name the filters. */
  readonly clientName = output<string | null>();
  readonly managerName = output<string | null>();

  private readonly auth = inject(AuthStore);
  private readonly clients = inject(ClientsClient);
  private readonly people = inject(MatterManagersClient);
  private readonly quiet = inject(QuietRequests);

  protected readonly phone = phoneCards();
  /** The phone's Filters sheet. */
  protected readonly sheet = signal(false);
  private readonly managed = inject(ManagedMatters);
  protected readonly roles: MmRole[] = ['both', 'primary', 'secondary'];
  protected readonly roleLabels = ROLE_LABELS;
  private readonly all = computed(() => this.filters().scope === 'all');
  /** Client: with two or more clients, in the All scope (any matter), or while a client is chosen (so it can be changed or cleared). */
  protected readonly showClient = computed(
    () =>
      this.auth.has('Client.View') &&
      (this.all() || this.managed.severalClients() || this.filters().clientId !== null),
  );
  /** Role: Primary on some matters and Secondary on others, in the All scope once a manager is named, or while a role is chosen. */
  protected readonly showRole = computed(
    () =>
      roleApplies(this.filters()) &&
      (this.all() || this.managed.mixedRoles() || this.filters().role !== 'both'),
  );
  /**
   * Anything to draw. While the matters are still being read nothing is guessed: a bar appears at once only for the All scope or a filter in force,
   * and the page does not jump for a person with one matter. (After a failed read everything is offered, as before.)
   */
  protected readonly drawn = computed(() => {
    if (this.all() || this.active() > 0) return true;
    if (this.managed.state() === 'loading') return false;
    return this.showClient() || this.showRole();
  });
  protected readonly client = signal<PickerOption | null>(null);
  protected readonly manager = signal<PickerOption | null>(null);

  protected readonly searchClients = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.clients.listClients(
        query,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        8,
        undefined,
      ),
    );
    return page.items.map(clientOption);
  };

  constructor() {
    // The chosen client follows the address (Back, Clear filters, a link): its name is fetched once for an id the bar did not pick itself.
    effect(() => {
      const id = this.filters().clientId;
      untracked(() => void this.syncClient(id));
    });
    // The chosen project manager follows the address too (Back, Clear filters); a name is looked up once for an id the bar did not pick.
    effect(() => {
      const id = this.filters().managerId;
      untracked(() => void this.syncManager(id));
    });
  }

  private async syncClient(id: number | null): Promise<void> {
    if (id === null) {
      this.client.set(null);
      this.clientName.emit(null);
      return;
    }
    if (this.client()?.id === id) {
      this.clientName.emit(this.client()!.label);
      return;
    }
    try {
      const c = await this.quiet.run(() => firstValueFrom(this.clients.getClient(id)));
      if (this.filters().clientId === id) {
        this.client.set(clientOption(c));
        this.clientName.emit(`${c.clientNumber} ${c.name}`);
      }
    } catch {
      this.client.set({ id, label: `Client ${id}` });
      this.clientName.emit(null);
    }
  }

  protected readonly searchManagers = async (query: string): Promise<PickerOption[]> => {
    const found = await firstValueFrom(this.people.lookupMatterManagers(query || undefined, 8));
    return found.map(managerOption);
  };

  private async syncManager(id: number | null): Promise<void> {
    if (id === null) {
      this.manager.set(null);
      this.managerName.emit(null);
      return;
    }
    if (this.manager()?.id === id) {
      this.managerName.emit(this.manager()!.label);
      return;
    }
    let pick: PickerOption = { id, label: `Project manager ${id}` };
    try {
      const people = await this.quiet.run(() =>
        firstValueFrom(this.people.lookupMatterManagers(undefined, 50)),
      );
      const known = people.find((p) => p.userId === id);
      if (known) pick = managerOption(known);
    } catch {
      // The id alone still filters.
    }
    if (this.filters().managerId === id) {
      this.manager.set(pick);
      this.managerName.emit(pick.label);
    }
  }

  protected clientPicked(pick: PickerOption | null): void {
    this.client.set(pick);
    this.clientName.emit(pick?.label ?? null);
    this.filterChange.emit({ clientId: pick?.id ?? null });
  }

  protected managerPicked(pick: PickerOption | null): void {
    this.manager.set(pick);
    this.managerName.emit(pick?.label ?? null);
    this.filterChange.emit({ managerId: pick?.id ?? null });
  }
}
