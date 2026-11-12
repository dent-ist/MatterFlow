import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EmbeddedViewRef,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  PeopleClient,
  PersonDto,
  PersonLookupItem,
  PersonSimilarItem,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { QuietRequests } from '../../core/http/interceptors';
import { NotificationService } from '../../core/notify/notification.service';
import { PersonNewForm, splitName } from './person-new-form';
import { PersonTypeBadge } from './person-type';
import { shortAccountName } from './person-name';
import { Tip } from './tip';

/** The words of the picker (D-20, D-44x): one place, so the specs and the pages that use it agree. */
export const PERSON_PICKER_MESSAGES = {
  /** The consumer shows this under the picker when text is typed but no person is picked: free text is never accepted. */
  pick: 'Choose a person from the list.',
  noPermission:
    "You don't have permission to add people. Ask a Project Manager or an administrator.",
  failed: "Couldn't search People.",
  empty: 'No people yet.',
  similarHeading: 'Did you mean this person?',
} as const;

/** A row of the list: a person, a person from the "Did you mean" hint, or the Create option. */
interface PickerRow {
  id: string;
  kind: 'person' | 'create';
  person?: PersonLookupItem;
  /** First row of the near-duplicate group: draws the group heading above it. */
  heading?: string;
  /** Why the row cannot be chosen (on the list already, deactivated, no permission). */
  disabled?: string;
  text?: string;
}

/** What the API's `PersonDto` is as a picker value. */
export function lookupItemOf(p: PersonDto): PersonLookupItem {
  return {
    personId: p.personId,
    displayName: p.displayName,
    personType: p.personType,
    title: p.title,
    email: p.email,
    companyName: p.companyName,
    userId: p.userId,
    isSystemUser: p.isSystemUser,
  };
}

/**
 * The person combobox (epic #1373, issue #1375; the mockup `docs/design/mockups/vendor-management`, "Edit Team"): type to search People (`GET /api/v1/people/lookup`: name, email, company
 * or title), pick one. Every option is one 36 px line: the name, a muted "title, company or email" (cut with an ellipsis, the whole is the tooltip) and "title, company or email" and the Internal, External or System User badge. Free text is never a value:
 * `selected` is set only by picking a record (the page reads `draftChange` to say "Choose a person from the list." when text is typed and nothing is picked).
 *
 * With `People.Manage` a typed name that is not in People also offers `+ Create "name"`, which opens the inline `mf-person-new-form` (saves with `POST /api/v1/people` and selects the
 * new person); without it the option is shown disabled with the reason. A typed name that resembles someone ("Laura Whitfeld") lists "Did you mean this person?" first
 * (`GET /api/v1/people/similar`, `People.Manage` only; without the permission the hint is not asked). The lookup is open to everyone who may edit a matter team.
 *
 * Standard combobox keys only, inside the control: Arrow Down and Arrow Up open and move, Enter picks, Esc closes the list (and leaves a dialog around it open). Nothing is registered
 * as a shortcut (#420). Ready for the Matter Team panel (#1376) and for vendor contacts: `taken` lists people already on the list (shown disabled with `takenLabel`) and `clearOnPick`
 * turns it into the "always empty row" of the Edit Team dialog (it emits `picked` and empties itself).
 *
 * ```html
 * <mf-person-picker inputId="team-add" label="Person" [(selected)]="person" [taken]="onTeam()" />
 * ```
 */
@Component({
  selector: 'mf-person-picker',
  imports: [PersonTypeBadge, PersonNewForm, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './form-field.scss',
  styles: `
    .pp__box {
      position: relative;
      display: grid;
    }
    .pp__field {
      position: relative;
      display: grid;
    }
    .pp__field > .pi {
      position: absolute;
      top: 50%;
      left: var(--mf-s3);
      transform: translateY(-50%);
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-md);
      pointer-events: none;
    }
    .pp__box .mf-field__input {
      padding-left: calc(var(--mf-s3) + var(--mf-icon-md) + var(--mf-s2));
    }
    .pp__new {
      margin-top: var(--mf-s2);
    }
    .pp__chosen {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-ctl-h);
      padding: var(--mf-s1) var(--mf-s3);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
    }
    .pp__chosen .pi {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-md);
    }
    .pp__grow {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pp__name {
      font-weight: var(--mf-fw-semibold);
    }
    .pp__meta {
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    /* The list is drawn in the body, like the shared dropdown (see the panel template): the styles follow it there. */
    .pp__panel {
      position: fixed;
      z-index: 3000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-pop);
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
    }
    .pp__list {
      flex: 1;
      margin: 0;
      padding: var(--mf-s1);
      overflow: auto;
      list-style: none;
    }
    .pp__gh {
      padding: var(--mf-s2) var(--mf-s3) var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .pp__why {
      padding: 0 var(--mf-s3) var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .pp__note {
      padding: var(--mf-s3);
      color: var(--mf-text-muted);
    }
    .pp__opt {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h);
      box-sizing: border-box;
      padding: var(--mf-s1) var(--mf-s3);
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .pp__opt > .pi {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-icon-md);
    }
    .pp__opt:hover {
      background: var(--mf-surface-alt);
    }
    .pp__opt--active {
      background: var(--mf-selected-bg);
    }
    .pp__opt[aria-disabled='true'] {
      color: var(--mf-text-disabled);
      cursor: not-allowed;
    }
    .pp__opt[aria-disabled='true'] .pp__meta,
    .pp__opt[aria-disabled='true'] > .pi {
      color: var(--mf-text-disabled);
    }
    .pp__opt[aria-disabled='true']:hover {
      background: transparent;
    }
    .pp__create .pp__grow {
      color: var(--mf-link);
      font-weight: var(--mf-fw-semibold);
    }
    .pp__create[aria-disabled='true'] .pp__grow {
      color: var(--mf-text-disabled);
    }
  `,
  template: `
    <div class="mf-field">
      <label class="mf-field__label" [attr.for]="inputId()">
        {{ label() }}
        @if (required()) {
          <span class="mf-field__req">(required)</span>
        }
      </label>
      @if (selected(); as s) {
        <div class="pp__chosen" data-chosen>
          <i class="pi pi-user" aria-hidden="true"></i>
          <span class="pp__grow" [mfTip]="detail(s)"
            ><span class="pp__name" data-chosen-name>{{ shown(s.displayName) }}</span
            ><span class="pp__meta">{{ metaOf(s) }}</span></span
          >
          <mf-person-type-badge [person]="s" />
          @if (!locked()) {
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-change
              [id]="inputId() + '-change'"
              [attr.aria-label]="'Change ' + label()"
              (click)="change()"
            >
              Change
            </button>
          }
        </div>
      } @else {
        <div class="pp__box">
          <div class="pp__field" #box>
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              #field
              class="mf-field__input"
              type="text"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              [id]="inputId()"
              [placeholder]="placeholder()"
              [disabled]="disabled()"
              [attr.aria-expanded]="showList()"
              [attr.aria-controls]="
                listShown() && open() && !creating() ? inputId() + '-list' : null
              "
              [attr.aria-activedescendant]="activeId()"
              [attr.aria-invalid]="error() ? 'true' : null"
              [attr.aria-describedby]="describedBy()"
              [value]="text()"
              (input)="onInput($event)"
              (click)="openList()"
              (keydown)="onKey($event)"
              (blur)="close()"
            />
          </div>
        </div>
        @if (creating()) {
          <div class="pp__new">
            <mf-person-new-form
              [text]="text()"
              [prefix]="inputId() + '-new'"
              (created)="onCreated($event)"
              (useExisting)="finish($event)"
              (cancelled)="creating.set(false)"
            />
          </div>
        }
      }
      @if (help()) {
        <p class="mf-field__help" [id]="inputId() + '-help'">{{ help() }}</p>
      }
      @if (error(); as e) {
        <p class="mf-field__error" role="alert" [id]="inputId() + '-error'">
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
        </p>
      }
    </div>

    <ng-template #panelTpl>
      <div
        class="pp__panel"
        data-person-panel
        [style.left.px]="pos().left"
        [style.top.px]="pos().above ? null : pos().top"
        [style.bottom.px]="pos().above ? pos().bottom : null"
        [style.width.px]="pos().width"
        [style.maxHeight.px]="pos().maxHeight"
      >
        @if (listShown()) {
          <ul
            class="pp__list"
            role="listbox"
            [attr.aria-label]="label()"
            [id]="inputId() + '-list'"
            data-person-list
          >
            @for (r of rows(); track r.id; let i = $index) {
              @if (r.heading) {
                <li class="pp__gh" role="presentation" data-group>{{ r.heading }}</li>
              }
              <li
                class="pp__opt"
                role="option"
                [id]="inputId() + '-opt-' + i"
                [class.pp__opt--active]="i === active()"
                [class.pp__create]="r.kind === 'create'"
                [attr.aria-selected]="i === active()"
                [attr.aria-disabled]="r.disabled ? 'true' : null"
                [attr.aria-describedby]="
                  r.kind === 'create' && r.disabled ? inputId() + '-why' : null
                "
                [attr.data-person-id]="r.person?.personId ?? null"
                [attr.data-create]="r.kind === 'create' ? '' : null"
                [mfTip]="r.kind === 'create' ? r.disabled || null : detail(r.person!)"
                (mousedown)="$event.preventDefault(); choose(r)"
              >
                @if (r.kind === 'create') {
                  <i class="pi" [class]="r.disabled ? 'pi-lock' : 'pi-plus'" aria-hidden="true"></i>
                  <span class="pp__grow">{{
                    r.disabled
                      ? 'Create "' + r.text + '" (not available)'
                      : 'Create "' + r.text + '"'
                  }}</span>
                } @else {
                  <i class="pi pi-user" aria-hidden="true"></i>
                  <span class="pp__grow"
                    ><span class="pp__name">{{ shown(r.person!.displayName) }}</span
                    ><span class="pp__meta">{{ metaOf(r.person!) }}</span></span
                  >
                  @if (r.disabled) {
                    <span class="pp__meta" data-option-note>{{ r.disabled }}</span>
                  } @else {
                    <mf-person-type-badge [person]="r.person!" />
                  }
                }
              </li>
              @if (r.kind === 'create' && r.disabled) {
                <li class="pp__why" role="presentation" [id]="inputId() + '-why'" data-create-note>
                  {{ r.disabled }}
                </li>
              }
            }
          </ul>
        } @else {
          <div class="pp__note" role="status" data-person-note>{{ note() }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class PersonPicker implements OnDestroy {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly placeholder = input('Search people by name, email or company');
  readonly help = input('');
  readonly required = input(false);
  readonly disabled = input(false);
  readonly error = input<string | null>(null);
  /** A locked value has no Change button. */
  readonly locked = input(false);
  /** People already on the list the picker adds to: shown, disabled, with `takenLabel`. */
  readonly taken = input<readonly number[]>([]);
  readonly takenLabel = input('On the List');
  /** The empty-row pattern (Edit Team): `picked` is emitted and the picker empties itself instead of showing the pick. */
  readonly clearOnPick = input(false);
  readonly debounceMs = input(250);

  /** The picked person; only a People record can be set, never typed text. */
  readonly selected = model<PersonLookupItem | null>(null);
  /** A person was picked or created (also with `clearOnPick`). */
  readonly picked = output<PersonLookupItem>();
  /** A new person was saved to People from the inline form (the page may refresh a count). */
  readonly created = output<PersonDto>();
  /** The text in the box changes: a page uses it to refuse a save while text is typed and nothing is picked. */
  readonly draftChange = output<string>();

  private readonly api = inject(PeopleClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);
  private readonly notify = inject(NotificationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly vcr = inject(ViewContainerRef);
  private readonly tpl = viewChild.required<TemplateRef<unknown>>('panelTpl');
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private view: EmbeddedViewRef<unknown> | null = null;
  protected readonly pos = signal({
    left: 0,
    top: 0,
    bottom: 0,
    above: false,
    width: 280,
    maxHeight: 320,
  });

  protected readonly canCreate = computed(() => this.auth.has('People.Manage'));
  protected readonly text = signal('');
  protected readonly people = signal<PersonLookupItem[]>([]);
  protected readonly similar = signal<PersonSimilarItem[]>([]);
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly loaded = signal(false);
  protected readonly active = signal(-1);
  protected readonly creating = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  protected readonly rows = computed((): PickerRow[] => {
    const typed = this.text().trim();
    const taken = new Set(this.taken());
    const out: PickerRow[] = this.people().map((p) => ({
      id: 'p' + p.personId,
      kind: 'person' as const,
      person: p,
      disabled: taken.has(p.personId) ? this.takenLabel() : undefined,
    }));
    const shown = new Set(this.people().map((p) => p.personId));
    const near = this.similar().filter((s) => !shown.has(s.person.personId));
    near.forEach((s, i) =>
      out.push({
        id: 's' + s.person.personId,
        kind: 'person',
        person: s.person,
        heading: i === 0 ? PERSON_PICKER_MESSAGES.similarHeading : undefined,
        disabled: !s.isActive
          ? 'Inactive'
          : taken.has(s.person.personId)
            ? this.takenLabel()
            : undefined,
      }),
    );
    const exact = this.people().some(
      (p) => p.displayName.trim().toLowerCase() === typed.toLowerCase(),
    );
    if (typed && !exact && this.loaded()) {
      out.push({
        id: 'create',
        kind: 'create',
        text: typed,
        disabled: this.canCreate() ? undefined : PERSON_PICKER_MESSAGES.noPermission,
      });
    }
    return out;
  });
  /** The listbox is drawn only when it has an option (a list of notes only is a status message, not a listbox without options). */
  protected readonly listShown = computed(() => !this.failed() && this.rows().length > 0);
  protected readonly showList = computed(() => this.open() && !this.creating() && this.listShown());
  protected readonly note = computed(() =>
    this.failed()
      ? PERSON_PICKER_MESSAGES.failed
      : this.loading() || !this.loaded()
        ? 'Searching...'
        : this.text().trim()
          ? `No one matches "${this.text().trim()}".`
          : PERSON_PICKER_MESSAGES.empty,
  );
  protected readonly activeId = computed(() =>
    this.showList() && this.active() >= 0 ? `${this.inputId()}-opt-${this.active()}` : null,
  );
  protected readonly describedBy = computed(() => {
    const id = this.inputId();
    const parts = [this.error() ? `${id}-error` : null, this.help() ? `${id}-help` : null].filter(
      Boolean,
    );
    return parts.length ? parts.join(' ') : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyPanel());
    // The list is a floating panel in the body, like the shared dropdown (it is never clipped by a scrolling dialog body): drawn while the list is open.
    effect(() => {
      const wanted = this.open() && !this.creating() && !!this.box();
      this.rows();
      this.note();
      untracked(() => (wanted ? this.showPanel() : this.destroyPanel()));
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private showPanel(): void {
    const box = this.box()?.nativeElement;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const view = this.doc.defaultView;
    const vw = view?.innerWidth ?? 1024;
    const vh = view?.innerHeight ?? 768;
    const below = vh - r.bottom - 16;
    const above = r.top - 16;
    const flip = below < 200 && above > below;
    const cap =
      20 * (parseFloat(view?.getComputedStyle(this.doc.documentElement).fontSize ?? '') || 14);
    this.pos.set({
      left: Math.max(8, Math.min(r.left, vw - r.width - 8)),
      top: r.bottom + 4,
      bottom: vh - r.top + 4,
      above: flip,
      width: Math.min(r.width, vw - 16),
      maxHeight: flip ? Math.min(cap, above) : Math.max(120, Math.min(cap, below)),
    });
    if (this.view) {
      this.view.detectChanges();
      return;
    }
    this.view = this.vcr.createEmbeddedView(this.tpl());
    this.view.detectChanges();
    for (const node of this.view.rootNodes) this.doc.body.appendChild(node as Node);
    view?.addEventListener('resize', this.away);
    view?.addEventListener('scroll', this.scrolled, true);
  }

  private destroyPanel(): void {
    if (!this.view) return;
    const view = this.doc.defaultView;
    view?.removeEventListener('resize', this.away);
    view?.removeEventListener('scroll', this.scrolled, true);
    this.view.destroy();
    this.view = null;
  }

  private readonly away = (): void => this.close();
  /** A scroll outside the list moves the field away from it: the list closes (the list's own scroll does not). */
  private readonly scrolled = (e: Event): void => {
    const panel = this.view?.rootNodes.find((n) => n instanceof HTMLElement) as
      HTMLElement | undefined;
    if (!(e.target instanceof Node && panel?.contains(e.target))) this.close();
  };

  /** D-62: a bare Windows account is shown without its domain. */
  protected shown(name: string): string {
    return shortAccountName(name);
  }

  /** The one muted line after the name: title, then company or email (cut with an ellipsis; the whole is the tooltip). */
  protected metaOf(p: PersonLookupItem): string {
    return [p.title, p.companyName || p.email].filter(Boolean).join(', ');
  }

  /** Tooltip: everything known about the person. */
  protected detail(p: PersonLookupItem): string {
    return [shortAccountName(p.displayName), p.title, p.companyName, p.email]
      .filter(Boolean)
      .join(', ');
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.text.set(value);
    this.draftChange.emit(value);
    this.open.set(true);
    this.active.set(-1);
    this.loaded.set(false);
    this.schedule(value);
  }

  protected openList(): void {
    if (this.disabled()) return;
    this.open.set(true);
    if (!this.loaded() && !this.loading()) this.schedule(this.text(), 0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.rows().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open()) {
        this.openList();
        return;
      }
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set(
        this.active() < 0 && step < 0 ? count - 1 : (this.active() + step + count) % count,
      );
    } else if (event.key === 'Enter' && this.open()) {
      event.preventDefault();
      const row = this.rows()[this.active()];
      if (row) this.choose(row);
    } else if (event.key === 'Escape' && this.open()) {
      // The list closes; the dialog around the picker stays open (the form dialog leaves a handled Esc alone).
      event.preventDefault();
      this.close();
    }
  }

  protected close(): void {
    this.open.set(false);
    this.active.set(-1);
  }

  protected choose(row: PickerRow): void {
    if (row.disabled) return;
    if (row.kind === 'create') {
      this.creating.set(true);
      this.close();
      return;
    }
    if (row.person) this.finish(row.person);
  }

  /** A person (picked, created or "used" from the hint) becomes the value. */
  protected finish(person: PersonLookupItem): void {
    const hadFocus = this.host.nativeElement.contains(document.activeElement);
    this.creating.set(false);
    this.close();
    this.people.set([]);
    this.similar.set([]);
    this.loaded.set(false);
    this.text.set('');
    this.draftChange.emit('');
    if (!this.clearOnPick()) this.selected.set(person);
    this.picked.emit(person);
    if (hadFocus || this.creating()) {
      this.focusLater(this.clearOnPick() ? this.inputId() : `${this.inputId()}-change`);
    }
  }

  protected onCreated(person: PersonDto): void {
    this.notify.success('Person created', `${person.displayName} is in People.`);
    this.created.emit(person);
    this.finish(lookupItemOf(person));
  }

  protected change(): void {
    this.selected.set(null);
    this.focusLater(this.inputId());
  }

  private focusLater(id: string): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[id="${id}"]`)?.focus());
  }

  private schedule(query: string, delay = this.debounceMs()): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(query), delay);
  }

  private async run(query: string): Promise<void> {
    const id = ++this.requestId;
    const typed = query.trim();
    this.loading.set(true);
    this.failed.set(false);
    try {
      const found = await firstValueFrom(
        this.quiet.run(() => this.api.lookupPeople(typed || undefined)),
      );
      if (id !== this.requestId) return;
      this.people.set(found);
      this.loaded.set(true);
      this.similar.set([]);
      this.active.set(-1);
      const exact = found.some((p) => p.displayName.trim().toLowerCase() === typed.toLowerCase());
      if (this.canCreate() && typed.length >= 3 && !exact) await this.runSimilar(typed, id);
    } catch {
      if (id === this.requestId) {
        this.people.set([]);
        this.failed.set(true);
        this.loaded.set(true);
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  /** The near-duplicate hint; it is help, so a failure shows nothing. */
  private async runSimilar(typed: string, id: number): Promise<void> {
    const { first, last } = splitName(typed);
    try {
      const near = await firstValueFrom(
        this.quiet.run(() => this.api.findSimilarPeople(first || undefined, last || undefined)),
      );
      if (id === this.requestId) this.similar.set(near);
    } catch {
      if (id === this.requestId) this.similar.set([]);
    }
  }
}
