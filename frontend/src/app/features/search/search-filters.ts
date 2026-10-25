import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AssetTypeResponse,
  AssetTypesClient,
  ClientsClient,
  MattersClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import type { SearchType } from '../../shared/search/search-meta';
import { EntityPicker, PickerOption } from '../../shared/ui/entity-picker';
import {
  ACTIVE_OPTIONS,
  REQUESTOR_MAX,
  REQUESTOR_MIN,
  SENSITIVE_OPTIONS,
  STATUS_CODES,
  SearchFilterValues,
  TYPE_FILTERS,
  Tri,
  filterChips,
  withoutFilter,
} from './search-filter-defs';
import { DEFAULT_STATUS_LABELS } from '../../core/lookups/lookup-store';

/**
 * The Filters panel of a type tab on the results page (Search review S6; #474 to #476): the controls of the type from `TYPE_FILTERS`, the chips of
 * the active filters (each removable, by keyboard too) and one "Clear filters". It holds no state of its own beyond the typing of a text box: the
 * values come from the address (`values`) and every change is emitted at once (`valuesChange`, the requestor text after a short pause), the page
 * writes it back to the address, so Back restores the filters and a result list can be shared. The panel is shown while `open`; the chips and
 * Clear filters show whenever a filter is active.
 *
 *   <mf-search-filters type="matter" [values]="filters()" [open]="panelOpen()" (valuesChange)="apply($event)" (cleared)="clear()" />
 */
@Component({
  selector: 'mf-search-filters',
  imports: [EntityPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    :host {
      display: block;
    }
    .sf-panel {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
      gap: var(--mf-s3) var(--mf-s4);
      align-items: start;
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .sf-field {
      display: grid;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .sf-field label,
    .sf-field legend {
      font-weight: 600;
    }
    .sf-statuses {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s4);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .sf-statuses legend {
      padding: 0;
      margin-bottom: var(--mf-s1);
      font-weight: 600;
    }
    .sf-statuses label {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h);
    }
    .sf-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      padding: 0;
      list-style: none;
    }
    .sf-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .sf-chip:hover {
      background: var(--mf-selected-bg);
    }
  `,
  template: `
    @if (open()) {
      <div
        class="sf-panel"
        id="search-filters-panel"
        role="group"
        aria-label="Filters"
        data-filters-panel
      >
        @for (kind of kinds(); track kind) {
          @switch (kind) {
            @case ('client') {
              <mf-entity-picker
                label="Client"
                inputId="sf-client"
                placeholder="Number or name"
                [search]="searchClients"
                [selected]="clientPick()"
                (selectedChange)="pickClient($event)"
              />
            }
            @case ('matter') {
              <mf-entity-picker
                label="Matter"
                inputId="sf-matter"
                placeholder="Reference or name"
                [search]="searchMatters"
                [selected]="matterPick()"
                (selectedChange)="pickMatter($event)"
              />
            }
            @case ('assetType') {
              <div class="sf-field">
                <label for="sf-asset-type">Asset type</label>
                <select
                  id="sf-asset-type"
                  class="mf-control pg-input"
                  [value]="values().assetType ?? ''"
                  (change)="setAssetType($any($event.target).value)"
                >
                  <option value="">Any type</option>
                  @for (t of assetTypes(); track t.assetTypeId) {
                    <option
                      [value]="t.assetTypeId"
                      [selected]="t.assetTypeId === values().assetType"
                    >
                      {{ t.name }}
                    </option>
                  }
                </select>
              </div>
            }
            @case ('active') {
              <div class="sf-field">
                <label for="sf-active">Status</label>
                <select
                  id="sf-active"
                  class="mf-control pg-input"
                  (change)="set('active', $any($event.target).value)"
                >
                  @for (o of activeOptions; track o.value) {
                    <option [value]="o.value" [selected]="o.value === values().active">
                      {{ o.label }}
                    </option>
                  }
                </select>
              </div>
            }
            @case ('sensitive') {
              <div class="sf-field">
                <label for="sf-sensitive">Sensitive matter</label>
                <select
                  id="sf-sensitive"
                  class="mf-control pg-input"
                  (change)="set('sensitive', $any($event.target).value)"
                >
                  @for (o of sensitiveOptions; track o.value) {
                    <option [value]="o.value" [selected]="o.value === values().sensitive">
                      {{ o.label }}
                    </option>
                  }
                </select>
              </div>
            }
            @case ('status') {
              <fieldset class="sf-statuses">
                <legend>Task status</legend>
                @for (code of statusCodes; track code) {
                  <label>
                    <input
                      type="checkbox"
                      [value]="code"
                      [checked]="values().status.includes(code)"
                      (change)="toggleStatus(code, $any($event.target).checked)"
                    />
                    {{ statusLabels[code] }}
                  </label>
                }
              </fieldset>
            }
            @case ('requestor') {
              <div class="sf-field">
                <label for="sf-requestor">Requestor</label>
                <input
                  id="sf-requestor"
                  class="mf-control pg-input"
                  type="text"
                  placeholder="Name or email"
                  [attr.maxlength]="requestorMax"
                  [value]="requestorDraft()"
                  (input)="typeRequestor($any($event.target).value)"
                />
              </div>
            }
          }
        }
      </div>
    }
    @if (chips().length > 0) {
      <ul class="sf-chips" aria-label="Active filters" data-filter-chips>
        @for (chip of chips(); track chip.kind) {
          <li>
            <button
              type="button"
              class="sf-chip"
              data-filter-chip
              [attr.aria-label]="'Remove filter ' + chip.label"
              (click)="remove(chip.kind)"
            >
              <span>{{ chip.label }}</span>
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </li>
        }
        <li>
          <button type="button" class="mf-btn mf-btn--text" data-clear-filters (click)="clear()">
            Clear filters
          </button>
        </li>
      </ul>
    }
  `,
})
export class SearchFilters {
  readonly type = input.required<SearchType>();
  /** The filters in the address. */
  readonly values = input.required<SearchFilterValues>();
  /** The panel with the controls is shown (the Filters button of the page header). */
  readonly open = input(false);
  /** The new filters after a change; the page writes them to the address. */
  readonly valuesChange = output<SearchFilterValues>();
  /** "Clear filters" was used (the page clears the address and returns focus to its Filters button). */
  readonly cleared = output<void>();

  private readonly auth = inject(AuthStore);
  private readonly clients = inject(ClientsClient);
  private readonly matters = inject(MattersClient);
  private readonly assetTypesApi = inject(AssetTypesClient);

  protected readonly activeOptions = ACTIVE_OPTIONS;
  protected readonly sensitiveOptions = SENSITIVE_OPTIONS;
  protected readonly statusCodes = STATUS_CODES;
  protected readonly statusLabels = DEFAULT_STATUS_LABELS;
  protected readonly requestorMax = REQUESTOR_MAX;

  /** The controls of the type; a record picker is offered only to a person who may view those records (the lookup would be refused). */
  protected readonly kinds = computed(() =>
    TYPE_FILTERS[this.type()].filter(
      (kind) =>
        (kind !== 'client' || this.auth.has('Client.View')) &&
        (kind !== 'matter' || this.auth.has('Matter.View')),
    ),
  );
  protected readonly assetTypes = signal<AssetTypeResponse[]>([]);
  /** Names of the picked records (the address holds only ids). */
  private readonly clientNames = signal<Record<number, string>>({});
  private readonly matterNames = signal<Record<number, string>>({});
  protected readonly requestorDraft = signal('');

  protected readonly clientPick = computed<PickerOption | null>(() => this.pickOf('client'));
  protected readonly matterPick = computed<PickerOption | null>(() => this.pickOf('matter'));

  protected readonly chips = computed(() =>
    filterChips(this.type(), this.values(), {
      client: (id) => this.clientNames()[id] ?? `Client ${id}`,
      matter: (id) => this.matterNames()[id] ?? `Matter ${id}`,
      assetType: (id) => this.assetTypes().find((t) => t.assetTypeId === id)?.name ?? `Type ${id}`,
    }),
  );

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // The text box shows what is in the address, unless the person is still typing.
    effect(() => {
      const requestor = this.values().requestor;
      untracked(() => {
        if (this.timer === undefined) this.requestorDraft.set(requestor);
      });
    });
    // Names for ids that arrive in an address (a shared link): asked once each.
    effect(() => {
      const id = this.values().client;
      if (id !== null && this.type() && !(id in untracked(this.clientNames)))
        void this.nameClient(id);
    });
    effect(() => {
      const id = this.values().matter;
      if (id !== null && !(id in untracked(this.matterNames))) void this.nameMatter(id);
    });
    effect(() => {
      if (this.kinds().includes('assetType') && untracked(this.assetTypes).length === 0)
        void this.loadAssetTypes();
    });
  }

  readonly searchClients = async (query: string): Promise<PickerOption[]> => {
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
    return page.items.map((c) => ({
      id: c.clientId,
      label: `${c.clientNumber} ${c.name}`,
      inactive: !c.isActive,
    }));
  };

  readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.matters.listMatters(
        query,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
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
    return page.items.map((m) => ({
      id: m.matterId,
      label: `${m.matterRef} ${m.name}`,
      inactive: !m.isActive,
    }));
  };

  protected pickClient(option: PickerOption | null): void {
    if (option) this.clientNames.update((n) => ({ ...n, [option.id]: option.label }));
    this.valuesChange.emit({ ...this.values(), client: option?.id ?? null });
  }

  protected pickMatter(option: PickerOption | null): void {
    if (option) this.matterNames.update((n) => ({ ...n, [option.id]: option.label }));
    this.valuesChange.emit({ ...this.values(), matter: option?.id ?? null });
  }

  protected setAssetType(value: string): void {
    this.valuesChange.emit({ ...this.values(), assetType: value ? Number(value) : null });
  }

  protected set(kind: 'active' | 'sensitive', value: Tri): void {
    this.valuesChange.emit({ ...this.values(), [kind]: value });
  }

  protected toggleStatus(code: string, on: boolean): void {
    const current = this.values().status;
    const next = on
      ? [...current.filter((c) => c !== code), code]
      : current.filter((c) => c !== code);
    this.valuesChange.emit({
      ...this.values(),
      status: STATUS_CODES.filter((c) => next.includes(c)),
    });
  }

  /** Typing: the address follows after a short pause, and only for an empty box or at least two characters. */
  protected typeRequestor(text: string): void {
    this.requestorDraft.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const value = text.trim();
      if (value !== '' && value.length < REQUESTOR_MIN) return;
      if (value !== this.values().requestor)
        this.valuesChange.emit({ ...this.values(), requestor: value });
    }, 400);
  }

  protected remove(kind: Parameters<typeof withoutFilter>[1]): void {
    this.valuesChange.emit(withoutFilter(this.values(), kind));
  }

  protected clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.requestorDraft.set('');
    this.cleared.emit();
  }

  private pickOf(kind: 'client' | 'matter'): PickerOption | null {
    const id = this.values()[kind];
    if (id === null) return null;
    const names = kind === 'client' ? this.clientNames() : this.matterNames();
    return { id, label: names[id] ?? `${kind === 'client' ? 'Client' : 'Matter'} ${id}` };
  }

  private async nameClient(id: number): Promise<void> {
    try {
      const c = await firstValueFrom(this.clients.getClient(id));
      this.clientNames.update((n) => ({ ...n, [id]: `${c.clientNumber} ${c.name}` }));
    } catch {
      this.clientNames.update((n) => ({ ...n, [id]: `Client ${id}` }));
    }
  }

  private async nameMatter(id: number): Promise<void> {
    try {
      const m = await firstValueFrom(this.matters.getMatter(id));
      this.matterNames.update((n) => ({ ...n, [id]: `${m.matterRef} ${m.name}` }));
    } catch {
      this.matterNames.update((n) => ({ ...n, [id]: `Matter ${id}` }));
    }
  }

  private async loadAssetTypes(): Promise<void> {
    try {
      this.assetTypes.set(
        (
          await firstValueFrom(
            this.assetTypesApi.listAssetTypes(undefined, undefined, undefined, 1, 100, undefined),
          )
        ).items,
      );
    } catch {
      this.assetTypes.set([]); // the filter then offers only "Any type"
    }
  }
}
