import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Button } from 'primeng/button';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { LandingLink, landingLink } from '../../core/auth/guards';
import { Permission } from '../../core/auth/permissions';
import { ApiError } from '../../core/http/api-error';
import { retryWhenBackOnline } from '../../core/http/connectivity';
import { QuietRequests } from '../../core/http/interceptors';
import { ErrorReference } from './error-reference';
import { Crumb, PageHeader } from './page-header';

/** The record pages that share these states. */
export type RecordKind =
  | 'client'
  | 'matter'
  | 'project'
  | 'task'
  | 'taskType'
  | 'workflow'
  | 'workflowVersion'
  | 'step'
  | 'asset'
  | 'assetType'
  | 'customField';

/** Why a record could not be shown: it does not exist (404), the person may not see it (403), or the load failed (5xx, offline, timeout). */
export type RecordFailure = 'notFound' | 'forbidden' | 'error';
export type RecordLoadState = 'loading' | 'ready' | RecordFailure;

/** The list a record page goes back to, and the words the three states use for it. */
const KINDS: Record<
  RecordKind,
  {
    noun: string;
    list: string;
    label: string;
    path: string;
    view: Permission;
    /**
     * Administration pages (#353): the breadcrumb starts `Administration > Task Types` and the last step is `crumb`, never the address id.
     * `own` is for a record whose list is the page itself (Asset Types, Custom Fields, #541): `Administration > <list> > crumb`.
     */
    admin?: { crumb: string; own?: boolean };
  }
> = {
  client: {
    noun: 'client',
    list: 'clients',
    label: 'Clients',
    path: '/clients',
    view: 'Client.View',
  },
  matter: {
    noun: 'matter',
    list: 'matters',
    label: 'Matters',
    path: '/matters',
    view: 'Matter.View',
  },
  project: {
    noun: 'project',
    list: 'projects',
    label: 'Projects',
    path: '/projects',
    view: 'Project.View',
  },
  task: {
    noun: 'task',
    list: 'Task Queue',
    label: 'Task Queue',
    path: '/tasks',
    view: 'Task.View',
  },
  taskType: {
    noun: 'task type',
    list: 'Task Types',
    label: 'Task Types',
    path: '/admin/task-types',
    view: 'TaskType.Manage',
    admin: { crumb: 'Task type' },
  },
  workflow: {
    noun: 'workflow',
    list: 'Workflows',
    label: 'Workflows',
    path: '/admin/workflows',
    view: 'Workflow.Manage',
    admin: { crumb: 'Workflow' },
  },
  workflowVersion: {
    noun: 'workflow version',
    list: 'Workflows',
    label: 'Workflows',
    path: '/admin/workflows',
    view: 'Workflow.Manage',
    admin: { crumb: 'Version' },
  },
  step: {
    noun: 'step',
    list: 'Workflow Steps',
    label: 'Workflow Steps',
    path: '/admin/steps',
    view: 'Workflow.Manage',
    admin: { crumb: 'Step' },
  },
  asset: {
    noun: 'asset',
    list: 'assets',
    label: 'Assets',
    path: '/assets',
    view: 'Asset.View',
  },
  assetType: {
    noun: 'asset type',
    list: 'Asset Types',
    label: 'Asset Types',
    path: '/admin/asset-types',
    view: 'AssetType.Manage',
    admin: { crumb: 'Asset type', own: true },
  },
  customField: {
    noun: 'object',
    list: 'Custom Fields',
    label: 'Custom Fields',
    path: '/admin/custom-fields',
    view: 'CustomField.Manage',
    admin: { crumb: 'Object', own: true },
  },
};

/**
 * Where the 404 and 403 states send the person. The record's list when they may open it; otherwise the page the landing rule picks (the
 * first one they can open, the same rule as after sign-in), named as the navigation names it; `null` when they can open nothing, so no
 * link is shown (a link to a page that answers 403 is worse than none).
 */
export function recordBackLink(kind: RecordKind, auth: AuthStore): LandingLink | null {
  const info = KINDS[kind];
  if (auth.has(info.view)) return { path: info.path, name: info.list };
  return landingLink(auth);
}

/** Maps a failed load to its state: 404 and 403 are answers, everything else (5xx, no connection, timeout) is a failure worth retrying. */
export function recordFailureOf(error: unknown): RecordFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'notFound';
    if (error.status === 403) return 'forbidden';
  }
  return 'error';
}

/** The one wording of the three states, so the three pages cannot drift apart. */
export function recordStateText(kind: RecordKind, state: RecordFailure): string {
  const noun = KINDS[kind].noun;
  switch (state) {
    case 'notFound':
      return `We couldn't find that ${noun}.`;
    case 'forbidden':
      return `You don't have access to this ${noun}.`;
    default:
      return `Couldn't load this ${noun}.`;
  }
}

/** The browser-tab title of a record that could not be shown ("Task type not found"); the page pins it while the state is on screen. */
export function recordStateTitle(kind: RecordKind, state: RecordLoadState): string {
  const noun = KINDS[kind].noun;
  const name = `${noun[0].toUpperCase()}${noun.slice(1)}`;
  switch (state) {
    case 'notFound':
      return `${name} not found`;
    case 'forbidden':
      return `No access to this ${noun}`;
    case 'error':
      return `${name} could not be loaded`;
    default:
      return name;
  }
}

/**
 * The load state of a record page (Client, Matter, Project): `loading` shows the skeleton, `ready` the page, and a failure the shared
 * `mf-record-state`. A Retry from a failure keeps that state on screen (so the Retry button keeps focus) until the answer arrives; when it
 * succeeds, focus moves to the page heading and a polite message says "Loaded". Create it in the page's field initialisers.
 */
export class RecordLoadFlow {
  private readonly injector = inject(Injector);
  private readonly quiet = inject(QuietRequests);

  readonly state = signal<RecordLoadState>('loading');
  /** True when the load ended in a 404, a 403 or a failure (the page shows `mf-record-state` instead of its header and body). */
  readonly failed = computed(() => {
    const s = this.state();
    return s === 'notFound' || s === 'forbidden' || s === 'error';
  });
  /** True while a Retry is waiting for its answer. */
  readonly retrying = signal(false);
  /** The page's polite live message ("Loading client" while retrying, "Loaded" after a successful retry). */
  readonly live = signal('');

  /** `kind` may be a function for a page whose record kind depends on its route (the form designer serves Task Types and Steps). */
  constructor(private readonly kindOf: RecordKind | (() => RecordKind)) {}

  private get kind(): RecordKind {
    return typeof this.kindOf === 'function' ? this.kindOf() : this.kindOf;
  }

  /** Starts a load. The request is quiet: the failure shows inline here, not as a toast as well (the error reference is kept). */
  async run<T>(request: () => Promise<T>, apply: (value: T) => void): Promise<void> {
    const retry =
      this.state() === 'notFound' || this.state() === 'forbidden' || this.state() === 'error';
    this.retrying.set(retry);
    if (retry) this.live.set(`Loading ${KINDS[this.kind].noun}`);
    else {
      this.live.set('');
      this.state.set('loading');
    }
    try {
      const value = await this.quiet.runInline(request);
      apply(value);
      this.state.set('ready');
      if (retry) {
        this.live.set('Loaded');
        afterNextRender(
          () => {
            const heading = document.querySelector<HTMLElement>('[data-page-title]');
            heading?.setAttribute('tabindex', '-1');
            heading?.focus();
          },
          { injector: this.injector },
        );
      }
    } catch (error) {
      this.state.set(recordFailureOf(error));
    } finally {
      this.retrying.set(false);
    }
  }
}

/**
 * What a Client, Matter or Project page shows instead of the record when it cannot be loaded (UX 5.6, #246):
 *
 *   404  "We couldn't find that client." and a link back to the list; no Retry
 *   403  "You don't have access to this client." and the link; no Retry
 *   5xx, no connection, timeout  "Couldn't load this client." with the error reference and Retry
 *
 * The record header and tabs are not shown; the breadcrumb is (the id is known from the address). While `busy` (a Retry is running)
 * the Retry button stays where it is and keeps focus.
 */
@Component({
  selector: 'mf-record-state',
  imports: [PageHeader, RouterLink, Button, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-page-header [crumbs]="crumbs()" [heading]="text()" icon="" />
    <div class="rs" [attr.data-record-state]="failure()">
      @if (failure() === 'error') {
        <div class="rs__alert" role="alert" data-record-error>
          Something went wrong. Try again.
          <mf-error-reference />
        </div>
        <div class="rs__act">
          <p-button
            label="Retry"
            severity="secondary"
            data-retry
            [attr.aria-busy]="busy() ? 'true' : null"
            (onClick)="retry()"
          />
          @if (busy()) {
            <span class="rs__busy" aria-hidden="true">Retrying...</span>
          }
        </div>
      } @else {
        @if (back(); as b) {
          <a class="rs__link" [routerLink]="b.path" data-back-link>Go to {{ b.name }}</a>
        }
      }
    </div>
  `,
  styles: `
    .rs {
      max-width: 40rem;
    }
    .rs__alert {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
    }
    .rs__act {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
    }
    .rs__busy {
      color: var(--mf-text-muted);
    }
    .rs__link {
      color: var(--mf-link);
    }
  `,
})
export class RecordState {
  readonly kind = input.required<RecordKind>();
  /** The record id from the address, for the breadcrumb. */
  readonly recordId = input('');
  /** The failure to show; anything else counts as a failed load. */
  readonly state = input.required<RecordLoadState>();
  /** A Retry is waiting for its answer. */
  readonly busy = input(false);
  /**
   * The record's parent when it loaded, shown in the breadcrumb before the record (a workflow version's workflow). Administration kinds only.
   */
  readonly parent = input<Crumb | null>(null);
  /** Moves focus to the heading once, when the state appears (the page it replaces had no heading to keep focus on). */
  readonly focusHeading = input(false);
  readonly retried = output<void>();

  private readonly auth = inject(AuthStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      if (!this.focusHeading()) return;
      const heading = this.host.nativeElement.querySelector<HTMLElement>('[data-page-title]');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    });
  }

  protected readonly info = computed(() => KINDS[this.kind()]);
  protected readonly back = computed(() => recordBackLink(this.kind(), this.auth));
  protected readonly failure = computed<RecordFailure>(() => {
    const s = this.state();
    return s === 'notFound' || s === 'forbidden' ? s : 'error';
  });
  protected readonly text = computed(() => recordStateText(this.kind(), this.failure()));
  protected readonly crumbs = computed<Crumb[]>(() => {
    const info = this.info();
    const id = this.recordId();
    if (info.admin) {
      const list: Crumb = this.auth.has(info.view)
        ? { label: info.label, link: info.path }
        : { label: info.label };
      const parent = this.parent();
      if (info.admin.own) {
        return [{ label: 'Administration' }, list, { label: info.admin.crumb }];
      }
      return [
        { label: 'Administration' },
        this.auth.hasAny(['TaskType.Manage', 'Workflow.Manage'])
          ? { label: 'Task Types', link: '/admin/task-types' }
          : { label: 'Task Types' },
        ...(info.path === '/admin/task-types' ? [] : [list]),
        ...(parent ? [parent] : []),
        { label: info.admin.crumb },
      ];
    }
    return [
      // A step the person cannot open is text, not a link to a 403.
      this.auth.has(info.view) ? { label: info.label, link: info.path } : { label: info.label },
      { label: id ? `${info.noun[0].toUpperCase()}${info.noun.slice(1)} ${id}` : info.noun },
    ];
  });

  protected retry(): void {
    if (!this.busy()) this.retried.emit();
  }

  /** The connection came back while the record shows "couldn't load": read it again once (S13, #611). */
  protected readonly autoRetry = retryWhenBackOnline(
    () => this.failure() === 'error',
    () => this.retry(),
  );
}
