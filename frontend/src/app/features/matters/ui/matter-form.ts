import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ServerFieldError } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  ClientResponse,
  ClientsClient,
  CurrentStatesClient,
  MatterAiAllowed,
  MatterCategoriesClient,
  MatterListItemView,
  MatterListRef,
  MatterResponse,
  MatterTypesClient,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { metaNumber, serverFormErrors } from '../../../shared/forms/api-errors';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import {
  PATH_MAX_LENGTH,
  pathProblem,
  pathToSend,
  serverPathMessage,
} from '../../../shared/forms/matter-paths';
import { normalizeNumber } from '../../../shared/pipes/matter-ref.pipe';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  CustomFieldsEditor,
  customFieldsProblems,
  splitFormErrors,
} from '../../../shared/ui/custom-fields';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { NumberInput, numberProblem } from '../../../shared/ui/number-input';
import { TagChips } from '../../../shared/ui/tag-chips';
import { TextField } from '../../../shared/ui/text-field';
import { AI_OPTIONS } from './matter-ai';

function clientOption(c: ClientResponse): PickerOption {
  return { id: c.clientId, label: `${c.clientNumber} ${c.name}`, inactive: !c.isActive };
}

function idText(ref: MatterListRef | undefined): string {
  return ref ? String(ref.id) : '';
}

/** The ids of a matter's Matter Types as the dropdown holds them (text), in the order the API lists them. */
function idTexts(refs: readonly MatterListRef[] | undefined): string[] {
  return (refs ?? []).map((r) => String(r.id));
}

/** Whether two id lists hold the same ids, whatever the order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The Matter Type ids the API takes (the full set; an empty list clears it). */
function typeIdsToSend(values: readonly string[]): number[] {
  return values.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

/** The id a pick-list dropdown holds (`''` is "Not Set") as the id the API takes (undefined clears the field). */
function listId(value: string): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * The choices of a Matter Category or Current State dropdown (UI spec 3): "Not Set" first, then the ACTIVE items in the administrator's order. A matter whose current item was
 * deactivated since shows it as "Name (inactive)", only while it is the selected entry (choosing anything else removes it from the list for good), and it is never
 * offered to a matter that does not have it.
 */
export function pickListItems(
  list: readonly MatterListItemView[],
  current: MatterListRef | undefined,
  selected: string,
): DropdownItem[] {
  const items: DropdownItem[] = [{ value: '', label: 'Not Set' }];
  const active = list.filter((i) => i.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const keep = current && selected === String(current.id) ? current : undefined;
  const lead = keep && !active.some((i) => i.id === keep.id) && !keep.isActive ? keep : undefined;
  if (lead) items.push({ value: String(lead.id), label: `${lead.name} (inactive)` });
  for (const i of active) items.push({ value: String(i.id), label: i.name });
  // The current item is always shown as the selected value, even when the list could not be loaded.
  if (keep && !items.some((i) => i.value === String(keep.id))) {
    items.push({ value: String(keep.id), label: keep.name });
  }
  return items;
}

/**
 * The choices of the Matter Types multi-select (epic #1368): the ACTIVE items in the administrator's order, no "Not Set" row (nothing chosen is "Not Set"). A type the matter
 * already has that was deactivated since shows as "Name (inactive)" for as long as it stays chosen (unchecking it removes it from the list for good); it is never offered to a
 * matter that does not have it.
 */
export function pickListItemsMulti(
  list: readonly MatterListItemView[],
  current: readonly MatterListRef[],
  selected: readonly string[],
): DropdownItem[] {
  const active = list.filter((i) => i.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const kept = current.filter(
    (c) => selected.includes(String(c.id)) && !active.some((i) => i.id === c.id),
  );
  return [
    ...kept.map((c) => ({
      value: String(c.id),
      label: c.isActive ? c.name : `${c.name} (inactive)`,
    })),
    ...active.map((i) => ({ value: String(i.id), label: i.name })),
  ];
}

/**
 * THE matter form (MD-43, #1061; owner decision 2026-11-03): one set of fields, in one order, for creating a matter and for editing one, so the same information is entered
 * the same way. Epic #1368 moved creating to a full page (`MatterCreatePage`, route `/matters/new`); editing stays the pop-up on the Summary (`MatterFormDialog`); both hold this
 * component and show its busy flag, error and Save in their own chrome.
 * Fields, in this order: Client, Matter number, CM Number (a read-only preview of client number plus matter number, never typed), Matter name, Sensitive matter, AI allowed,
 * Matter Types (several can be chosen), Matter Category (one), Current State, DMS Path, DFS Path (epic #1298; all optional and "Not Set" is the first choice of the single lists)
 * and the custom fields. On Save the Types, Category, State and the two paths are sent as full values (the API treats them so: leaving one out clears it), starting from the
 * matter's own. Labels, help texts, validation messages and the unsaved-changes question are the same in both modes.
 *
 * New (`matter` null): Client and Matter number are editable (`clientId` preselects the client, from a Client page). Edit (`matter` given): Client and Matter number sit in the
 * same places but are locked. The Matter number can be unlocked (needs `Matter.EditNumber`, the existing rule of `PUT /matters/{id}/number`) after a short confirmation, and a
 * changed number is confirmed once more on Save with the exact result ("The CM Number changes from A to B"); then the number is changed first and the rest saved with the new
 * row version. The Client cannot change: the API has no way to move a matter to another client, so it stays locked with its reason.
 * Marking a matter sensitive can end the editor's own access: the server answers 409 `SENSITIVE_CONFIRMATION_REQUIRED` and the next Save confirms. After a confirmed loss of
 * access `lostAccess` fires instead of `saved` (the page would answer "not found").
 */
@Component({
  selector: 'mf-matter-form',
  imports: [
    Dropdown,
    ConfirmDialog,
    EntityPicker,
    NumberInput,
    TextField,
    TagChips,
    CustomFieldsEditor,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .mfd__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .mfd__form .pg-field {
      display: grid;
      gap: var(--mf-s1);
    }
    .mfd__summary {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-overdue-solid);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
    .mfd__cm {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      min-height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-sem-info-bg);
      font-weight: 700;
    }
    .mfd__cm--empty {
      background: transparent;
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .mfd__lock {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    @if (summary().length > 0) {
      <div class="mfd__summary" role="alert" data-summary>
        Fix the following to save:
        <ul>
          @for (message of summary(); track message) {
            <li>{{ message }}</li>
          }
        </ul>
        @if (existingId(); as existing) {
          <a class="mf-link" [routerLink]="['/matters', existing]">View the Existing Matter</a>
        }
      </div>
    }
    <form class="mfd__form" novalidate (submit)="$event.preventDefault(); save()">
      <div>
        <mf-entity-picker
          inputId="matter-client"
          label="Client"
          placeholder="343 or Acme"
          [required]="true"
          [locked]="isEdit()"
          [search]="searchClients"
          [error]="clientError()"
          [(selected)]="client"
        />
        @if (isEdit()) {
          <p class="mfd__lock" data-client-lock>
            A matter stays with its client; it cannot be moved to another client.
          </p>
        }
      </div>

      <div>
        <mf-number-input
          inputId="matter-number"
          label="Matter Number"
          noun="matter number"
          help="Enter 1 to 5 digits, as issued by the firm's main system. It must not be used by another matter of the same client."
          [disabled]="isEdit() && numberLocked()"
          [showErrors]="submitted()"
          [serverError]="fieldError('matterNumber')"
          [(value)]="number"
        />
        @if (isEdit() && canChangeNumber()) {
          <p class="mfd__lock" data-number-lock>
            @if (numberLocked()) {
              <span>The matter number is locked.</span>
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-change-number
                (click)="askUnlock.set(true)"
              >
                Change
              </button>
            } @else {
              <span>The matter number can be changed now.</span>
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-keep-number
                (click)="keepNumber()"
              >
                Keep the Current Number
              </button>
            }
          </p>
        } @else if (isEdit()) {
          <p class="mfd__lock" data-number-lock>
            Changing a matter number needs the permission to edit numbers.
          </p>
        }
      </div>

      <div class="pg-field" data-cm-number>
        <span class="mf-label" id="matter-cm-label">CM Number</span>
        <output
          class="mfd__cm pg-mono"
          [class.mfd__cm--empty]="!cm()"
          aria-labelledby="matter-cm-label"
          aria-live="polite"
          data-cm-value
          >{{ cm() || 'Choose a client and enter a matter number' }}</output
        >
        <span class="pg-reason" style="display: block"
          >The client number and the matter number together. It is shown here for reference and is
          never typed.</span
        >
      </div>

      <mf-text-field
        inputId="matter-name"
        label="Matter Name"
        [required]="true"
        [maxLength]="300"
        [error]="nameError()"
        [(value)]="name"
      />

      <label class="pg-radio">
        <input
          type="checkbox"
          name="matter-sensitive"
          [checked]="isSensitive()"
          [attr.aria-invalid]="fieldError('isSensitive') ? 'true' : null"
          [attr.aria-describedby]="fieldError('isSensitive') ? 'matter-sensitive-error' : null"
          (change)="isSensitive.set($any($event.target).checked)"
        />
        <span>
          Sensitive matter
          <span class="pg-reason" style="display: block"
            >Restricts this matter, with its tasks and assets, to its project managers, people
            assigned one of its tasks and people who may see all sensitive matters. Everyone else
            does not see it at all. Also shows a warning banner.</span
          >
          @if (fieldError('isSensitive'); as problem) {
            <span
              class="pg-reason pg-reason--error"
              style="display: block"
              id="matter-sensitive-error"
              data-sensitive-error
              >{{ problem }}</span
            >
          }
        </span>
      </label>

      <div class="mf-field">
        <label class="mf-field__label" for="matter-ai">AI Allowed</label>
        <mf-dropdown
          field
          buttonId="matter-ai"
          label="AI Allowed"
          data-ai-allowed
          [items]="aiItems"
          [value]="aiAllowed()"
          (valueChange)="aiAllowed.set($any($event))"
        />
        <span class="mf-field__help"
          >Which AI tools may be used on this matter's content. Notes check this setting before AI
          is offered.</span
        >
      </div>

      <div class="mf-field">
        <label class="mf-field__label" for="matter-type">Matter Types</label>
        <mf-dropdown
          field
          [multi]="true"
          buttonId="matter-type"
          label="Matter Types"
          placeholder="Not Set"
          data-matter-type
          [items]="typeItems()"
          [search]="typeItems().length > 10"
          [values]="matterTypeIds()"
          (valuesChange)="chooseTypes($any($event))"
        />
        @if (chosenTypeNames().length > 1) {
          <mf-tag-chips label="Chosen matter types" [tags]="chosenTypeNames()" [max]="8" />
        }
        <span class="mf-field__help"
          >Optional. What kind of matter this is; choose as many as apply.</span
        >
      </div>

      <div class="mf-field">
        <label class="mf-field__label" for="matter-category">Matter Category</label>
        <mf-dropdown
          field
          buttonId="matter-category"
          label="Matter Category"
          data-matter-category
          [items]="categoryItems()"
          [search]="categoryItems().length > 10"
          [value]="matterCategoryId()"
          (valueChange)="matterCategoryId.set($any($event))"
        />
        <span class="mf-field__help">Optional. The category the matter belongs to; one only.</span>
      </div>

      <div class="mf-field">
        <label class="mf-field__label" for="matter-state">Current State</label>
        <mf-dropdown
          field
          buttonId="matter-state"
          label="Current State"
          data-current-state
          [items]="stateItems()"
          [search]="stateItems().length > 10"
          [value]="currentStateId()"
          (valueChange)="currentStateId.set($any($event))"
        />
        <span class="mf-field__help"
          >Optional. Where the matter stands now. Each change is recorded in the audit log.</span
        >
      </div>

      <mf-text-field
        inputId="matter-dms-path"
        label="DMS Path"
        data-dms-path
        help="A network path (\\servershare...) or a web address (https://...). Optional."
        [maxLength]="pathLimit"
        [counter]="true"
        [error]="dmsError()"
        (blurred)="dmsTouched.set(true)"
        [(value)]="dmsPath"
      />

      <mf-text-field
        inputId="matter-dfs-path"
        label="DFS Path"
        data-dfs-path
        help="A network path (\\servershare...) or a web address (https://...). Optional."
        [maxLength]="pathLimit"
        [counter]="true"
        [error]="dfsError()"
        (blurred)="dfsTouched.set(true)"
        [(value)]="dfsPath"
      />

      <mf-custom-fields-editor
        [versionId]="customVersionId()"
        [values]="customValues()"
        [serverErrors]="customErrors()"
        (touched)="customTouched.set(true)"
      />
    </form>

    <mf-confirm-dialog
      title="Unlock Matter Number"
      confirmLabel="Unlock Matter Number"
      [(visible)]="askUnlock"
      (confirmed)="unlockNumber()"
    >
      <p data-unlock-body>
        The matter number is part of the CM Number {{ matter()?.matterRef }}, which is used in
        references everywhere (tasks, assets, reports), so change it only to correct a mistake.
      </p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Change CM Number"
      confirmLabel="Change CM Number"
      [busy]="busy()"
      [(visible)]="askNumberChange"
      (confirmed)="confirmNumberChange()"
    >
      <p data-number-change-body>
        The CM Number changes from {{ matter()?.matterRef }} to {{ newCm() }}, and it is used in
        references everywhere.
      </p>
    </mf-confirm-dialog>
  `,
})
export class MatterForm {
  /** The matter to edit; null makes the form "New matter". */
  readonly matter = input<MatterResponse | null>(null);
  /** True while the form is on screen (a dialog host sets it to its `visible`): each time it turns true the fields start again from the matter (or empty). */
  readonly active = input(true);
  /** New mode: preselects the client (a link from a Client page); null for none. */
  readonly clientId = input<number | null>(null);
  readonly saved = output<MatterResponse>();
  readonly lostAccess = output<void>();

  private readonly api = inject(MattersClient);
  private readonly clients = inject(ClientsClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly customEditor = viewChild(CustomFieldsEditor);
  private readonly injector = inject(Injector);
  private readonly typesApi = inject(MatterTypesClient);
  private readonly categoriesApi = inject(MatterCategoriesClient);
  private readonly statesApi = inject(CurrentStatesClient);
  private readonly quiet = inject(QuietRequests);

  protected readonly aiItems: DropdownItem[] = AI_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));
  protected readonly isEdit = computed(() => this.matter() !== null);
  protected readonly client = signal<PickerOption | null>(null);
  protected readonly number = signal('');
  protected readonly name = signal('');
  protected readonly isSensitive = signal(false);
  protected readonly aiAllowed = signal<MatterAiAllowed>(MatterAiAllowed.No);
  /** Matter Types: the ids of the chosen items as text (none = Not Set). */
  protected readonly matterTypeIds = signal<readonly string[]>([]);
  /** Matter Category and Current State: the chosen item's id as text, `''` for "Not Set". */
  protected readonly matterCategoryId = signal('');
  protected readonly currentStateId = signal('');
  protected readonly dmsPath = signal('');
  protected readonly dfsPath = signal('');
  protected readonly dmsTouched = signal(false);
  protected readonly dfsTouched = signal(false);
  protected readonly pathLimit = PATH_MAX_LENGTH;
  private readonly types = signal<readonly MatterListItemView[]>([]);
  private readonly categories = signal<readonly MatterListItemView[]>([]);
  private readonly states = signal<readonly MatterListItemView[]>([]);
  protected readonly typeItems = computed(() =>
    pickListItemsMulti(this.types(), this.matter()?.matterTypes ?? [], this.matterTypeIds()),
  );
  /** The names of the chosen types in the list's order, for the chips under the control. */
  protected readonly chosenTypeNames = computed(() => {
    const chosen = this.matterTypeIds();
    return this.typeItems()
      .filter((i) => chosen.includes(i.value))
      .map((i) => i.label);
  });
  protected readonly categoryItems = computed(() =>
    pickListItems(this.categories(), this.matter()?.matterCategory, this.matterCategoryId()),
  );
  protected readonly stateItems = computed(() =>
    pickListItems(this.states(), this.matter()?.currentState, this.currentStateId()),
  );
  /** A path is checked when the person leaves the field and on Save, never per keystroke; a server answer shows until the next Save. */
  protected readonly dmsError = computed(
    () =>
      this.fieldError('dmsPath') ||
      (this.dmsTouched() || this.submitted() ? pathProblem(this.dmsPath()) : null),
  );
  protected readonly dfsError = computed(
    () =>
      this.fieldError('dfsPath') ||
      (this.dfsTouched() || this.submitted() ? pathProblem(this.dfsPath()) : null),
  );
  /** The host shows these in its own chrome (the dialog's footer, the page's banner and buttons). */
  readonly busy = signal(false);
  readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly summary = signal<string[]>([]);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly existingId = signal<number | null>(null);
  protected readonly customVersionId = signal<number | null>(null);
  protected readonly customValues = signal<Record<string, unknown>>({});
  protected readonly customErrors = signal<ServerFieldError[]>([]);
  protected readonly customTouched = signal(false);
  /** Edit: the matter number is locked until the person confirms the unlock. */
  protected readonly numberLocked = signal(true);
  protected readonly askUnlock = signal(false);
  protected readonly askNumberChange = signal(false);
  /** The server said that this save ends the editor's access: the next Save confirms. */
  private lossAsked = false;

  protected readonly canChangeNumber = computed(() => this.auth.has('Matter.EditNumber'));

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

  /** The CM Number (client number, a dash, matter number), live from the two inputs; empty until both are known. */
  protected readonly cm = computed(() => {
    const clientNo = this.client()?.label.split(' ')[0];
    const matterNo = normalizeNumber(this.number());
    return clientNo && matterNo ? `${clientNo}-${matterNo}` : '';
  });
  protected readonly newCm = this.cm;
  protected readonly numberChanged = computed(() => {
    const m = this.matter();
    const n = normalizeNumber(this.number());
    return !!m && !!n && n !== m.matterNumber;
  });
  protected readonly clientError = computed(() =>
    this.submitted() && !this.client() ? 'Select a client.' : this.fieldError('clientId'),
  );
  protected readonly nameError = computed(() =>
    this.submitted() && this.name().trim() === ''
      ? 'Enter a matter name.'
      : this.fieldError('name'),
  );
  /** Typed into the form, so closing asks first. A preselected client alone is not a change. */
  readonly dirty = computed(() => {
    const m = this.matter();
    if (!m) {
      return (
        this.number().trim() !== '' ||
        this.name().trim() !== '' ||
        this.isSensitive() ||
        this.matterTypeIds().length > 0 ||
        this.matterCategoryId() !== '' ||
        this.currentStateId() !== '' ||
        this.dmsPath().trim() !== '' ||
        this.dfsPath().trim() !== '' ||
        this.customTouched()
      );
    }
    return (
      this.name() !== m.name ||
      this.isSensitive() !== m.isSensitive ||
      this.aiAllowed() !== (m.aiAllowed ?? MatterAiAllowed.No) ||
      !sameIds(this.matterTypeIds(), idTexts(m.matterTypes)) ||
      this.matterCategoryId() !== idText(m.matterCategory) ||
      this.currentStateId() !== idText(m.currentState) ||
      this.dmsPath().trim() !== (m.dmsPath ?? '') ||
      this.dfsPath().trim() !== (m.dfsPath ?? '') ||
      this.numberChanged() ||
      this.customTouched()
    );
  });

  constructor() {
    // Each opening starts from the matter (or empty), so a cancelled form never shows in the next one.
    effect(() => {
      if (!this.active()) return;
      const m = this.matter();
      const preselect = this.clientId();
      untracked(() => {
        this.client.set(
          m
            ? {
                id: m.clientId,
                label: `${m.clientNumber} ${m.clientName}`,
                inactive: !m.clientIsActive,
              }
            : null,
        );
        this.number.set(m?.matterNumber ?? '');
        this.name.set(m?.name ?? '');
        this.isSensitive.set(m?.isSensitive ?? false);
        this.aiAllowed.set(m?.aiAllowed ?? MatterAiAllowed.No);
        this.matterTypeIds.set(idTexts(m?.matterTypes));
        this.matterCategoryId.set(idText(m?.matterCategory));
        this.currentStateId.set(idText(m?.currentState));
        this.dmsPath.set(m?.dmsPath ?? '');
        this.dfsPath.set(m?.dfsPath ?? '');
        this.dmsTouched.set(false);
        this.dfsTouched.set(false);
        void this.loadLists();
        this.customValues.set({ ...(m?.formValues ?? {}) });
        this.customVersionId.set(m?.publishedFormVersionId ?? null);
        this.customTouched.set(false);
        this.customErrors.set([]);
        this.serverErrors.set({});
        this.summary.set([]);
        this.existingId.set(null);
        this.submitted.set(false);
        this.error.set('');
        this.lossAsked = false;
        this.numberLocked.set(true);
        this.askUnlock.set(false);
        this.askNumberChange.set(false);
        if (!m) {
          void this.loadCustomForm();
          if (preselect) void this.preselectClient(preselect);
        }
      });
    });
  }

  /** The chosen Matter Types, kept in the order of the list (not the order of the clicks), so the button, the chips and the request all read the same. */
  protected chooseTypes(values: readonly string[]): void {
    this.matterTypeIds.set(
      this.typeItems()
        .map((i) => i.value)
        .filter((v) => values.includes(v)),
    );
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  protected unlockNumber(): void {
    this.numberLocked.set(false);
    this.askUnlock.set(false);
  }

  protected keepNumber(): void {
    this.number.set(this.matter()?.matterNumber ?? '');
    this.serverErrors.update((e) => ({ ...e, matterNumber: '' }));
    this.numberLocked.set(true);
  }

  /** The three pick lists, read on every opening (an administrator may have changed them); a failure leaves "Not Set" and the matter's own choices. */
  private async loadLists(): Promise<void> {
    const [types, categories, states] = await Promise.all([
      firstValueFrom(this.quiet.run(() => this.typesApi.listMatterTypes())).catch(() => []),
      firstValueFrom(this.quiet.run(() => this.categoriesApi.listMatterCategories())).catch(
        () => [],
      ),
      firstValueFrom(this.quiet.run(() => this.statesApi.listCurrentStates())).catch(() => []),
    ]);
    this.types.set(types);
    this.categories.set(categories);
    this.states.set(states);
  }

  private async loadCustomForm(): Promise<void> {
    try {
      const form = await firstValueFrom(this.api.getMatterCustomFieldForm());
      this.customVersionId.set(form.publishedFormVersionId ?? null);
    } catch {
      this.customVersionId.set(null); // no custom fields section
    }
  }

  private async preselectClient(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      this.client.set(clientOption(await firstValueFrom(this.clients.getClient(id))));
    } catch {
      // The picker stays empty; the person can search.
    }
  }

  /** Validates the form; the problems go to the summary. Returns the custom values to send (undefined: none, or untouched on edit). */
  private validate(): { ok: boolean; custom?: Record<string, unknown> } {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    this.existingId.set(null);
    const problems: string[] = [];
    if (!this.client()) problems.push('Select a client.');
    const problem = numberProblem(this.number(), 'matter number');
    if (problem) problems.push(problem);
    if (this.name().trim() === '') problems.push('Enter a matter name.');
    for (const problem of [pathProblem(this.dmsPath()), pathProblem(this.dfsPath())]) {
      if (problem && !problems.includes(problem)) problems.push(problem);
    }
    this.customErrors.set([]);
    const custom = this.customEditor()?.collect(this.isEdit() ? this.customValues() : undefined);
    problems.push(...customFieldsProblems(custom));
    if (problems.length > 0) {
      this.summary.set(problems);
      focusFirstInvalid(this.injector);
      return { ok: false };
    }
    return { ok: true, custom: custom?.values };
  }

  async save(): Promise<void> {
    const v = this.validate();
    if (!v.ok) return;
    if (!this.isEdit()) {
      await this.create(v.custom);
      return;
    }
    // A changed matter number is confirmed with its exact result before anything is saved.
    if (this.numberChanged() && !this.askNumberChange()) {
      this.askNumberChange.set(true);
      return;
    }
    await this.update(v.custom);
  }

  protected async confirmNumberChange(): Promise<void> {
    const v = this.validate();
    if (!v.ok) {
      this.askNumberChange.set(false);
      return;
    }
    await this.update(v.custom);
  }

  private async create(custom: Record<string, unknown> | undefined): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await firstValueFrom(
        this.api.createMatter({
          clientId: this.client()!.id,
          matterNumber: this.number().trim(),
          name: this.name().trim(),
          isSensitive: this.isSensitive(),
          aiAllowed: this.aiAllowed(),
          matterTypeIds: typeIdsToSend(this.matterTypeIds()),
          matterCategoryId: listId(this.matterCategoryId()),
          currentStateId: listId(this.currentStateId()),
          dmsPath: pathToSend(this.dmsPath()),
          dfsPath: pathToSend(this.dfsPath()),
          formValues: custom,
        }),
      );
      if (saved.droppedFields.length > 0) {
        this.notify.info('Hidden values not saved', `${saved.droppedFields.join(', ')}.`);
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      this.saved.emit(saved);
    } catch (err) {
      this.showFailure(err);
    } finally {
      this.busy.set(false);
    }
  }

  private async update(custom: Record<string, unknown> | undefined): Promise<void> {
    let current = this.matter()!;
    const confirmLoss = this.lossAsked;
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.numberChanged()) {
        current = await firstValueFrom(
          this.api.changeMatterNumber(current.matterId, {
            number: this.number().trim(),
            rowVersion: current.rowVersion,
          }),
        );
        this.notify.success('CM Number changed', current.matterRef);
      }
      const saved = await firstValueFrom(
        this.api.updateMatter(current.matterId, {
          name: this.name().trim(),
          isSensitive: this.isSensitive(),
          aiAllowed: this.aiAllowed(),
          // Matter Types, Matter Category, Current State and the two paths are FULL values on PUT (leaving one out clears it): they start from the matter's own and are always sent.
          matterTypeIds: typeIdsToSend(this.matterTypeIds()),
          matterCategoryId: listId(this.matterCategoryId()),
          currentStateId: listId(this.currentStateId()),
          dmsPath: pathToSend(this.dmsPath()),
          dfsPath: pathToSend(this.dfsPath()),
          confirmLossOfAccess: confirmLoss || undefined,
          formValues: custom,
          rowVersion: current.rowVersion,
        }),
      );
      if (saved.droppedFields.length > 0) {
        this.notify.info('Hidden values not saved', `${saved.droppedFields.join(', ')}.`);
      }
      this.askNumberChange.set(false);
      if (confirmLoss) {
        this.notify.success(
          `Matter ${saved.matterRef} saved`,
          'It is sensitive now and you no longer see it.',
        );
        this.lostAccess.emit();
        return;
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      this.saved.emit(saved);
    } catch (err) {
      this.askNumberChange.set(false);
      if (err instanceof ApiError && err.code === 'SENSITIVE_CONFIRMATION_REQUIRED') {
        this.lossAsked = true;
        this.error.set(
          'You will no longer see this matter after it is marked sensitive. Press Save changes again to confirm.',
        );
        return;
      }
      this.showFailure(err);
    } finally {
      this.busy.set(false);
    }
  }

  private showFailure(err: unknown): void {
    const errors = serverFormErrors(err);
    const split = splitFormErrors(errors.fields);
    // The number endpoint names its field `number`; the form calls it `matterNumber`.
    const base = { ...split.base };
    if (base['number'] && !base['matterNumber']) base['matterNumber'] = base['number'];
    // The path messages are chosen by the API's field codes, so they read as the UI spec words them.
    for (const field of ['dmsPath', 'dfsPath'] as const) {
      const message = serverPathMessage(err, field);
      if (message) base[field] = message;
    }
    this.serverErrors.set(base);
    this.customErrors.set(split.form);
    this.summary.set(errors.summary);
    this.existingId.set(metaNumber(err, 'existingId'));
    if (errors.conflict) {
      this.error.set(
        this.isEdit()
          ? 'This matter was changed by someone else. Close the dialog and reopen it.'
          : 'This matter was changed by someone else.',
      );
    }
  }
}
