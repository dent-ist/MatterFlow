import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, UrlTree } from '@angular/router';
import { iconForPath } from '../layout/section-icons';
import { ActionMenu, MenuAction } from './action-menu';
import { ActiveBadge, SensitiveBadge } from './badge';
import { MatterRef } from './matter-ref';
import { Crumb, RecordTitle } from './page-header';
import { RecordKind } from './record-state';

/** Longest last breadcrumb step (the current page) before it is cut with an ellipsis; the full text is its tooltip (H1, #253). */
export const CRUMB_MAX = 40;

/** The text of the sentence in the Sensitive note (wording from the Sensitive banner, unchanged). */
export const SENSITIVE_LEAD = 'Sensitive matter.';
export const SENSITIVE_TEXT =
  'Handle its tasks and assets with extra care. This flag is a warning only and does not restrict who can see them.';

/** `label` cut to `max` characters with an ellipsis as the last one; shorter text is returned as it is. */
export function truncateCrumb(label: string, max = CRUMB_MAX): string {
  const text = label.trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

/** The queries the header follows: phone is below 640 px (as the work-list cards), desktop is 1024 px and up (H2, #254). */
const PHONE_QUERY = '(max-width: 639.98px)';
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * One action of a record header. `role` decides where it sits (C3, #255):
 *   edit, activity, primary   buttons in the header (primary = the create action, last so it sits top right)
 *   secondary, state          always in the overflow (secondary creates; Set inactive / Set active / Archive / Restore)
 * On a tablet (640 to 1023 px) only the primary action and the next one of Edit and Activity stay in the header; on a phone only the
 * primary action does. Everything that does not fit moves to the overflow, in the order Edit, Activity, secondary, state.
 */
export interface RecordAction extends MenuAction {
  role: 'edit' | 'activity' | 'primary' | 'secondary' | 'state';
  /** Extra sentence for an enabled button (tooltip and `aria-describedby`), for example "2 steps need information". */
  hint?: string | null;
}

const LIST: Record<RecordKind, { label: string; link: string }> = {
  client: { label: 'Clients', link: '/clients' },
  matter: { label: 'Matters', link: '/matters' },
  project: { label: 'Projects', link: '/projects' },
  task: { label: 'Task Queue', link: '/tasks' },
};

let nextId = 0;

/**
 * The header of a Client, Matter or Project page (H1 #253, H2 #254, C3 #255, H1b #256), composed on `mf-record-title`:
 *
 *   Clients > Matters > 00107-00001 Long na...      crumb: the last step is the current page, cut at 40 characters (a phone: "Back to Matters")
 *   [icon] 00107-00001  Name of the record, at most two lines  [badges]       [Edit] [Activity] [Create task] [...]
 *   Client 00107 Hartwell & Bryce LLP               context line (the `mfContext` slot), muted, one line
 *   [lock] Sensitive matter. ...                    only for a Sensitive matter, one line, a `role="note"`
 *
 * The title is the page's `h1` at the H2 size. `actions` is data (the page builds it from its permissions); see `RecordAction`. With
 * `skeleton` it draws the same boxes with grey bars (`mf-record-skeleton`), so nothing moves when the record arrives.
 */
@Component({
  selector: 'mf-record-header',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    RecordTitle,
    ActiveBadge,
    SensitiveBadge,
    MatterRef,
    ActionMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './record-header.scss',
  template: `
    <header class="rh" data-record-header [attr.data-kind]="kind()" [class.rh--sk]="skeleton()">
      <nav class="rh__crumbs" aria-label="Breadcrumb">
        <a class="rh__back" [routerLink]="back().link" [state]="back().state" data-back-link>
          <i class="pi pi-arrow-left" aria-hidden="true"></i>
          Back to {{ back().label }}
        </a>
        <ol class="rh__trail">
          @for (c of parents(); track $index) {
            <li>
              @if (skeleton() && !c.link) {
                <span class="rh__sk" aria-hidden="true" data-crumb-skeleton></span>
              } @else if (c.label.length > crumbMax) {
                <a [routerLink]="c.link" [state]="c.state" [attr.title]="c.label">
                  <span aria-hidden="true">{{ cut(c.label) }}</span>
                  <span class="mf-sr-only">{{ c.label }}</span>
                </a>
              } @else {
                <a [routerLink]="c.link" [state]="c.state">{{ c.label }}</a>
              }
            </li>
          }
          <li class="rh__cur">
            @if (skeleton()) {
              <span class="rh__sk" aria-hidden="true" data-crumb-skeleton></span>
            } @else {
              <span
                aria-current="page"
                data-crumb-current
                [attr.title]="shortCrumb() === current() ? null : current()"
              >
                <span aria-hidden="true">{{ shortCrumb() }}</span>
                <span class="mf-sr-only">{{ current() }}</span>
              </span>
            }
          </li>
        </ol>
      </nav>
      <div class="rh__row">
        <h1 class="rh__title" data-page-title>
          <!-- The Task page puts its task type icon here (mfIcon); the other records show the icon of their section. -->
          <ng-content select="[mfIcon]">
            <i class="rh__icon" [class]="icon()" aria-hidden="true" data-page-icon></i>
          </ng-content>
          @if (skeleton()) {
            <span class="rh__sk rh__sk--title" data-title-skeleton></span>
          } @else {
            @if (kind() === 'matter') {
              <mf-record-title [name]="name()" [clamp]="true" [stack]="true">
                <mf-matter-ref mfRef [value]="ref()" />
                <ng-container *ngTemplateOutlet="badges" />
              </mf-record-title>
            } @else {
              <mf-record-title [ref]="ref()" [name]="name()" [clamp]="true" [stack]="!!ref()">
                <ng-container *ngTemplateOutlet="badges" />
              </mf-record-title>
            }
          }
        </h1>
        <div class="rh__actions" data-page-actions>
          @for (a of buttons(); track a.id) {
            <button
              type="button"
              class="mf-btn rh__btn"
              [class.mf-btn--primary]="a.role === 'primary'"
              [attr.data-action]="a.id"
              [attr.aria-disabled]="a.disabled ? 'true' : null"
              [attr.aria-describedby]="buttonNote(a) ? uid + '-r-' + a.id : null"
              [attr.title]="buttonNote(a)"
              (click)="a.disabled ? null : a.run()"
            >
              @if (a.icon) {
                <i class="pi" [class]="a.icon" aria-hidden="true"></i>
              }
              {{ a.label }}
            </button>
            @if (buttonNote(a); as text) {
              <span class="mf-sr-only" [id]="uid + '-r-' + a.id">{{ text }}</span>
            }
          }
          <mf-action-menu [items]="menu()" />
        </div>
      </div>
      <p class="rh__ctx" data-record-context><ng-content select="[mfContext]" /></p>
      @if (skeleton() && kind() !== 'client') {
        <p class="rh__ctx rh__ctx--sk"><span class="rh__sk rh__sk--ctx"></span></p>
      }
      <ng-template #badges>
        @if (kind() !== 'task') {
          <mf-active-badge [active]="active()" [inactiveLabel]="inactiveLabel()" />
        }
        @if (sensitive()) {
          <mf-sensitive-badge [describedBy]="noteId" />
        }
      </ng-template>
      @if (sensitive() && !skeleton()) {
        <p class="rh__note" role="note" [id]="noteId" data-sensitive-banner [attr.title]="note">
          <i class="pi pi-lock" aria-hidden="true"></i>
          <span class="rh__note-text"
            ><strong>{{ lead }}</strong> {{ text }}</span
          >
        </p>
      }
    </header>
  `,
})
export class RecordHeader {
  readonly kind = input.required<RecordKind>();
  /** The steps before the current page (links), for example Matters for a Matter and Matters > 00107-00001 for a Project. */
  readonly parents = input<readonly Crumb[]>([]);
  /** The full text of the last step (the current page); it is cut at 40 characters on screen. */
  readonly current = input('');
  /** The record's reference or number in monospace before the name (a Matter's has the copy button). */
  readonly ref = input('');
  readonly name = input('');
  readonly active = input(true);
  /** `Archived` for a project. */
  readonly inactiveLabel = input('Inactive');
  readonly sensitive = input(false);
  /** Where "Back to ..." goes (a phone) when it is not the record's own list, for example the list a Task was opened from (`?from=`). */
  readonly backTo = input<{
    label: string;
    link: string | UrlTree;
    state?: Record<string, unknown>;
  } | null>(null);
  readonly actions = input<readonly RecordAction[]>([]);
  /** Grey bars instead of the record while it loads. */
  readonly skeleton = input(false);

  protected readonly uid = `rh-${nextId++}`;
  protected readonly noteId = `${this.uid}-note`;
  protected readonly lead = SENSITIVE_LEAD;
  protected readonly text = SENSITIVE_TEXT;
  protected readonly note = `${SENSITIVE_LEAD} ${SENSITIVE_TEXT}`;

  protected readonly list = computed(() => LIST[this.kind()]);
  protected readonly back = computed<{
    label: string;
    link: string | UrlTree;
    state?: Record<string, unknown>;
  }>(() => this.backTo() ?? this.list());
  protected readonly crumbMax = CRUMB_MAX;
  /** The sentence that goes with a header button: why it is disabled, else its hint. */
  protected buttonNote(a: RecordAction): string | null {
    return (a.disabled && a.reason ? a.reason : a.hint) || null;
  }
  protected readonly cut = truncateCrumb;
  protected readonly icon = computed(() => iconForPath(this.list().link) ?? '');
  protected readonly shortCrumb = computed(() => truncateCrumb(this.current()));

  private readonly phone = signal(false);
  private readonly desktop = signal(true);

  /** The actions that are buttons at this width: desktop all of Edit, Activity and the primary one; tablet two of them; phone the primary one. */
  protected readonly buttons = computed(() => {
    const all = this.actions().filter(
      (a) => a.role === 'edit' || a.role === 'activity' || a.role === 'primary',
    );
    const room = this.phone() ? 1 : this.desktop() ? 3 : 2;
    const keep = new Set(
      ['primary', 'edit', 'activity']
        .flatMap((role) => all.filter((a) => a.role === role))
        .slice(0, room),
    );
    return all.filter((a) => keep.has(a));
  });

  protected readonly menu = computed<MenuAction[]>(() => {
    const shown = new Set(this.buttons());
    const order = ['edit', 'activity', 'primary', 'secondary', 'state'];
    return order
      .flatMap((role) => this.actions().filter((a) => a.role === role))
      .filter((a) => !shown.has(a));
  });

  constructor() {
    if (typeof matchMedia !== 'function') return;
    const destroyRef = inject(DestroyRef);
    for (const [query, target] of [
      [PHONE_QUERY, this.phone],
      [DESKTOP_QUERY, this.desktop],
    ] as const) {
      const mq = matchMedia(query);
      const follow = (): void => target.set(mq.matches);
      follow();
      mq.addEventListener?.('change', follow);
      destroyRef.onDestroy(() => mq.removeEventListener?.('change', follow));
    }
  }
}
