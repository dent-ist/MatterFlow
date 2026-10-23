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
import {
  MmFilters,
  MmRange,
  MmRole,
  RANGE_LABELS,
  ROLE_LABELS,
  roleApplies,
} from './my-matters-filters';

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
 * The filters of My Matters (README 6.8): Client (a typeahead; only with Client.View), Role (Both, Primary, Secondary), the date range of
 * Upcoming deadlines (Today, next 2 weeks, next 4 weeks, Custom) and, in the All matters scope, a Project manager. The page keeps them in the
 * address; this bar only reports a change. "No project manager" is not a filter here: a matter without a manager is normal, never a
 * thing to look for.
 */
@Component({
  selector: 'mf-mm-filter-bar',
  imports: [ConfirmDialog, EntityPicker, NgTemplateOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .fb {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s3) var(--mf-s4);
      margin: 0 0 var(--mf-s3);
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
    .fb__hint {
      flex: 1 0 100%;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .fb--phone {
      margin-bottom: var(--mf-s2);
    }
    @media (max-width: 639.98px) {
      .fb__field,
      .fb__client,
      .fb__select {
        width: 100%;
        max-width: none;
      }
      .fb .mf-btn,
      .fb select,
      .fb input {
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (phone()) {
      <div class="fb fb--phone">
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
      </div>
      <mf-confirm-dialog
        title="Filters"
        cancelLabel="Show results"
        [showConfirm]="false"
        [(visible)]="sheet"
      >
        <ng-container *ngTemplateOutlet="controls" />
      </mf-confirm-dialog>
    } @else {
      <ng-container *ngTemplateOutlet="controls" />
    }
    <ng-template #controls>
      <div class="fb" data-mm-filters>
        @if (canClient()) {
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
        <div class="fb__field">
          <label for="mm-range">Dates</label>
          <select
            id="mm-range"
            class="mf-control mf-control--compact fb__select"
            data-filter="range"
            [value]="filters().range"
            (change)="rangePicked($any($event.target).value)"
          >
            @for (r of ranges; track r) {
              <option [value]="r" [selected]="r === filters().range">{{ rangeLabels[r] }}</option>
            }
          </select>
        </div>
        @if (filters().range === 'custom') {
          <div class="fb__field">
            <label for="mm-from">From</label>
            <input
              id="mm-from"
              type="date"
              class="mf-control mf-control--compact"
              data-filter="from"
              [value]="filters().from ?? ''"
              (change)="filterChange.emit({ from: $any($event.target).value || null })"
            />
          </div>
          <div class="fb__field">
            <label for="mm-to">To</label>
            <input
              id="mm-to"
              type="date"
              class="mf-control mf-control--compact"
              data-filter="to"
              [value]="filters().to ?? ''"
              (change)="filterChange.emit({ to: $any($event.target).value || null })"
            />
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
        <p class="fb__hint">
          The dates apply to Upcoming deadlines. The other panels show all open work.
        </p>
      </div>
    </ng-template>
  `,
})
export class MyMattersFilterBar {
  readonly filters = input.required<MmFilters>();
  /** How many filters differ from the default (Clear filters shows from 1). */
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
  protected readonly roles: MmRole[] = ['both', 'primary', 'secondary'];
  protected readonly ranges: MmRange[] = ['today', '2w', '4w', 'custom'];
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly rangeLabels = RANGE_LABELS;
  protected readonly canClient = computed(() => this.auth.has('Client.View'));
  protected readonly showRole = computed(() => roleApplies(this.filters()));
  protected readonly client = signal<PickerOption | null>(null);
  protected readonly manager = signal<PickerOption | null>(null);

  protected readonly searchClients = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.clients.listClients(query, undefined, undefined, undefined, 1, 8, undefined),
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

  protected rangePicked(value: MmRange): void {
    this.filterChange.emit(
      value === 'custom' ? { range: value } : { range: value, from: null, to: null },
    );
  }
}
