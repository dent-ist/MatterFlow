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
  MatterResponse,
  MattersClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { QuietRequests } from '../../core/http/interceptors';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EntityPicker, PickerOption } from '../../shared/ui/entity-picker';
import { SearchSelect } from '../../shared/ui/search-select';
import { phoneCards } from '../../shared/ui/record-card-list';
import { ManagedMatters } from './managed-matters';
import { MmFilters, MmRole, ROLE_LABELS, roleApplies } from './my-matters-filters';

/** How many clients (or matters) the dropdown asks for at a time when the list cannot be given whole. */
const CLIENT_LIST_MAX = 50;
const MATTER_LIST_MAX = 50;

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

const matterOption = (m: MatterResponse): PickerOption => ({
  id: m.matterId,
  label: `${m.matterRef} ${m.name}`,
});

/**
 * The filters of My Matters (README 6.8): Client (a searchable dropdown, issue #928: the clients of the person's matters, narrowed as they type; only with Client.View) and, right
 * next to it, Matter (issue #941: the same component and height, "All matters"; a PAGE filter, it limits the grid, the Calendar, the Breakdown, the Data tab and the Activity list; its
 * list narrows to the chosen client, and choosing a client clears a matter that is not that client's). Neither has a visible label: the placeholder ("All clients", "All matters") says what
 * the box is and an aria-label names it. Then Role (Both, Primary, Secondary) and, in the All matters scope,
 * a Project manager. The page keeps them in the address; this bar only reports a change. "No project manager" is not a filter here: a matter
 * without a manager is normal, never a thing to look for.
 *
 * A control is drawn only when it can change the result (issue #906): Client when the person's matters belong to two or more clients, Matter when they have two or more
 * matters, Role when they are Primary on some and Secondary on others. With neither the bar is not drawn at all (0 px). A filter that is in force (the address, or
 * what was remembered) always keeps its control, so the page is never filtered by something the person cannot see or clear. The bar is the same
 * on every tab: the date range of the Deadlines tab is a control of that tab (`MmDatesControl`), not of this bar.
 */
@Component({
  selector: 'mf-mm-filter-bar',
  imports: [ConfirmDialog, EntityPicker, NgTemplateOutlet, RouterLink, SearchSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.fb-phone]': 'phone()' },
  styles: `
    :host {
      display: block;
    }
    /* A phone (issue #922): the bar is only the Filters button, and it sits in the page header's actions beside the Options menu. */
    :host(.fb-phone) {
      display: inline-flex;
    }
    :host(.fb-phone:empty) {
      display: none;
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
    /* One label style for every filter of the bar (issue #899): the form-label look of Client (weight 600, the page's text size and colour). */
    .fb__field label,
    :host ::ng-deep .fb .mf-field__label {
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
      font-weight: 600;
      line-height: 1.4;
    }
    /* Definite widths (not percentages): the bar is a flex item of the page's top row, and a percentage would make its max-content too small and wrap Role and
       Clear filters under the dropdowns. */
    .fb__client {
      width: 16rem;
      max-width: 100%;
    }
    .fb__matter {
      width: 24rem;
      max-width: 100%;
    }
    /* The picker keeps its label beside its box (about 7 rem for "Project manager" and 15 rem for the box), so it gets its own, wider, definite width. */
    .fb__manager {
      width: 26rem;
      max-width: 100%;
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
      margin: 0;
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
      /* The dropdown shrinks with its field instead of running over the next filter's label. */
      :host ::ng-deep .fb__client mf-search-select,
      :host ::ng-deep .fb__matter mf-search-select {
        flex: 1 1 auto;
        min-width: 0;
      }
      :host ::ng-deep :is(.fb__client, .fb__matter) .mf-field {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
      }
      :host ::ng-deep :is(.fb__client, .fb__matter) .mf-field > :not(label) {
        flex: 1 1 auto;
        min-width: 0;
      }
      :host ::ng-deep :is(.fb__client, .fb__matter) .mf-field__label {
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
      .fb__matter,
      .fb__manager,
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
            <mf-search-select
              label="Client"
              [hideLabel]="true"
              inputId="mm-client"
              allLabel="All clients"
              [options]="clientOptions()"
              [search]="searchClients"
              [selected]="client()"
              (selectedChange)="clientPicked($event)"
            />
          </div>
        }
        @if (showMatter()) {
          <div class="fb__field fb__matter">
            <mf-search-select
              label="Matter"
              [hideLabel]="true"
              inputId="mm-matter"
              allLabel="All matters"
              [options]="matterOptions()"
              [search]="searchMatters"
              [selected]="matter()"
              (selectedChange)="matterPicked($event)"
            />
          </div>
        }
        @if (filters().scope === 'all') {
          <div class="fb__field fb__manager">
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
            <label for="mm-role">{{ filters().scope === 'all' ? 'Their role' : 'I am' }}</label>
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
  readonly matterName = output<string | null>();

  private readonly auth = inject(AuthStore);
  private readonly clients = inject(ClientsClient);
  private readonly people = inject(MatterManagersClient);
  private readonly mattersApi = inject(MattersClient);
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
  /** Matter: with two or more matters (and after a failed read), in the All scope (any matter), or while a matter is chosen (so it can be changed or cleared). */
  protected readonly showMatter = computed(
    () =>
      this.auth.has('Matter.View') &&
      (this.all() ||
        !this.managed.complete() ||
        this.managed.items().length >= 2 ||
        this.filters().matterId !== null),
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
    return this.showClient() || this.showMatter() || this.showRole();
  });
  protected readonly client = signal<PickerOption | null>(null);
  protected readonly manager = signal<PickerOption | null>(null);
  protected readonly matter = signal<PickerOption | null>(null);
  /** The client of the matters seen so far (the list, the answers), so a client choice can tell whether the chosen matter is that client's. */
  private readonly clientOfMatter = new Map<number, number>();

  /**
   * The clients of the matters the person manages, when all of those matters were read and the scope is "mine": the whole list, narrowed as they type. In the
   * All matters scope (any matter of the firm) or when the list is partial, null: the clients are asked for as they type instead.
   */
  protected readonly clientOptions = computed<PickerOption[] | null>(() => {
    if (this.all() || !this.managed.complete()) return null;
    const byId = new Map<number, PickerOption>();
    for (const m of this.managed.items()) {
      byId.set(m.clientId, {
        id: m.clientId,
        label: `${m.clientNumber} ${m.clientName}`,
      });
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  });

  /**
   * The matters of the person's list when all of them were read and the scope is "mine": the whole list, narrowed to the chosen client and role, then by what is typed. In the All
   * matters scope or when the list is partial, null: the matters are asked for as they type instead.
   */
  protected readonly matterOptions = computed<PickerOption[] | null>(() => {
    if (this.all() || !this.managed.complete()) return null;
    const f = this.filters();
    const me = this.auth.profile()?.userId ?? 0;
    return this.managed
      .items()
      .filter((m) => f.clientId === null || m.clientId === f.clientId)
      .filter((m) =>
        f.role === 'primary'
          ? m.primaryManager?.userId === me
          : f.role === 'secondary'
            ? m.secondaryManager?.userId === me
            : true,
      )
      .map(matterOption)
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const f = this.filters();
    const me = this.auth.profile()?.userId ?? undefined;
    const who = f.scope === 'all' ? (f.managerId ?? undefined) : me;
    // The matters the page is about: the person's own (by the place they hold) or, in the All scope, the named manager's, or any active matter.
    const place =
      who === undefined || (f.scope === 'all' && f.managerId === null)
        ? {}
        : f.role === 'primary'
          ? { primary: who }
          : f.role === 'secondary'
            ? { secondary: who }
            : f.scope === 'all'
              ? { manager: who }
              : { managed: true };
    const page = await firstValueFrom(
      this.mattersApi.listMatters(
        query || undefined,
        f.clientId ?? undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        'primary' in place ? place.primary : undefined,
        'secondary' in place ? place.secondary : undefined,
        'manager' in place ? place.manager : undefined,
        'managed' in place ? true : undefined,
        undefined,
        undefined,
        undefined,
        1,
        MATTER_LIST_MAX,
        undefined,
      ),
    );
    for (const m of page.items) this.clientOfMatter.set(m.matterId, m.clientId);
    return page.items.map(matterOption);
  };

  protected readonly searchClients = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.clients.listClients(
        query || undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        CLIENT_LIST_MAX,
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
    // The chosen matter follows the address too (Back, Clear filters, a link): its name is read from the list, or fetched once, for an id the bar did not pick itself.
    effect(() => {
      const id = this.filters().matterId;
      untracked(() => void this.syncMatter(id));
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

  private async syncMatter(id: number | null): Promise<void> {
    if (id === null) {
      this.matter.set(null);
      this.matterName.emit(null);
      return;
    }
    if (this.matter()?.id === id) {
      this.matterName.emit(this.matter()!.label);
      return;
    }
    const known = this.managed.items().find((m) => m.matterId === id);
    if (known) {
      this.matter.set(matterOption(known));
      this.clientOfMatter.set(id, known.clientId);
      this.matterName.emit(matterOption(known).label);
      return;
    }
    try {
      const m = await this.quiet.run(() => firstValueFrom(this.mattersApi.getMatter(id)));
      if (this.filters().matterId === id) {
        this.matter.set(matterOption(m));
        this.clientOfMatter.set(id, m.clientId);
        this.matterName.emit(matterOption(m).label);
      }
    } catch {
      if (this.filters().matterId === id) {
        this.matter.set({ id, label: `Matter ${id}` });
        this.matterName.emit(null);
      }
    }
  }

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
    // A client choice clears a matter of another client (issue #941).
    const chosen = this.filters().matterId;
    const of =
      chosen === null
        ? undefined
        : (this.clientOfMatter.get(chosen) ??
          this.managed.items().find((m) => m.matterId === chosen)?.clientId);
    const clears = pick !== null && of !== undefined && of !== pick.id;
    this.filterChange.emit(
      clears ? { clientId: pick.id, matterId: null } : { clientId: pick?.id ?? null },
    );
  }

  protected matterPicked(pick: PickerOption | null): void {
    this.matter.set(pick);
    this.matterName.emit(pick?.label ?? null);
    this.filterChange.emit({ matterId: pick?.id ?? null });
  }

  protected managerPicked(pick: PickerOption | null): void {
    this.manager.set(pick);
    this.managerName.emit(pick?.label ?? null);
    this.filterChange.emit({ managerId: pick?.id ?? null });
  }
}
