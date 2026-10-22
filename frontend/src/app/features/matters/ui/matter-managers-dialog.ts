import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  MatterManagerItem,
  MatterManagersClient,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';

/** One matter the dialog changes: its id, how it reads in the result list, the row version last read and the managers it has now. */
export interface ManagerTarget {
  readonly matterId: number;
  readonly label: string;
  readonly rowVersion: string;
  readonly primary: { readonly userId: number; readonly displayName: string } | null;
  readonly secondary: { readonly userId: number; readonly displayName: string } | null;
}

/** What a run of the dialog changed: the matters as saved and the ones that could not be changed, with the reason. */
export interface ManagersSaved {
  readonly updated: readonly MatterResponse[];
  readonly failed: readonly { readonly target: ManagerTarget; readonly message: string }[];
}

const KEEP = '__keep__';
const NONE = '';
/** At most this many requests run at once for a bulk change. */
const CONCURRENCY = 3;

/**
 * Sets the Primary and the Secondary project manager of one matter (the matter header's Change) or of several (the Matters list's bulk
 * "Set project managers"). Out-of-office people are marked but can still be chosen. With several matters each picker starts on "Leave
 * unchanged" (every matter keeps its own value), "No project manager" clears it and a person sets it for all of them. A matter that
 * cannot take the change (somebody else changed it meanwhile, or the new Primary is already its Secondary) is listed with the reason and
 * the others are saved. A matter without a manager is normal: there is no warning anywhere in this dialog.
 */
@Component({
  selector: 'mf-matter-managers-dialog',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .mmd {
      display: grid;
      gap: var(--mf-s3);
    }
    .mmd__field {
      display: grid;
      gap: var(--mf-s1);
    }
    .mmd__label {
      font-weight: 600;
    }
    .mmd__help {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mmd__error {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .mmd__list {
      margin: 0;
      padding-left: var(--mf-s5);
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <mf-confirm-dialog
      [title]="title()"
      [confirmLabel]="failed().length > 0 ? 'Try the rest again' : 'Save'"
      [showConfirm]="canSave()"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="visible"
      (confirmed)="save()"
    >
      <div class="mmd" data-managers-dialog>
        @if (bulk()) {
          <p class="mmd__help" data-managers-bulk-note>
            {{ targets().length }} matters selected. Leave a field unchanged to keep what each
            matter has.
          </p>
        }
        <div class="mmd__field">
          <label class="mmd__label" [for]="uid + '-primary'">Primary project manager</label>
          <select
            class="mf-control"
            [id]="uid + '-primary'"
            data-manager-select="primary"
            [attr.aria-describedby]="uid + '-help'"
            (change)="primaryChoice.set($any($event.target).value)"
          >
            @for (o of options(); track o.value) {
              <option [value]="o.value" [selected]="o.value === primaryChoice()">
                {{ o.label }}
              </option>
            }
          </select>
        </div>
        <div class="mmd__field">
          <label class="mmd__label" [for]="uid + '-secondary'">Secondary project manager</label>
          <select
            class="mf-control"
            [id]="uid + '-secondary'"
            data-manager-select="secondary"
            [attr.aria-describedby]="uid + '-help'"
            (change)="secondaryChoice.set($any($event.target).value)"
          >
            @for (o of options(); track o.value) {
              <option [value]="o.value" [selected]="o.value === secondaryChoice()">
                {{ o.label }}
              </option>
            }
          </select>
        </div>
        <p class="mmd__help" [id]="uid + '-help'">
          Both have the same rights. A matter can have one, both or none. People who are out of
          office can still be chosen.
        </p>
        @if (sameChosen()) {
          <p class="mmd__error" role="alert" data-managers-same>
            Choose two different people, or leave one empty.
          </p>
        }
        @if (loadFailed()) {
          <p class="mmd__error" role="alert" data-managers-load-failed>
            The list of people could not be loaded. Close this and try again.
          </p>
        }
        @if (failed().length > 0) {
          <div role="alert" data-managers-failed>
            <p class="mmd__label">
              {{ savedCount() }} saved. {{ failed().length }} could not be changed:
            </p>
            <ul class="mmd__list">
              @for (f of failed(); track f.target.matterId) {
                <li>{{ f.target.label }}: {{ f.message }}</li>
              }
            </ul>
          </div>
        }
      </div>
    </mf-confirm-dialog>
  `,
})
export class MatterManagersDialog {
  readonly targets = input.required<readonly ManagerTarget[]>();
  readonly visible = model(false);
  /** Fires once a run finished with at least one matter saved (the page reloads its data). */
  readonly saved = output<ManagersSaved>();

  private readonly people = inject(MatterManagersClient);
  private readonly matters = inject(MattersClient);
  private readonly quiet = inject(QuietRequests);
  private readonly notify = inject(NotificationService);

  protected readonly uid = `mmd${Math.random().toString(36).slice(2, 8)}`;
  protected readonly bulk = computed(() => this.targets().length > 1);
  protected readonly title = computed(() =>
    this.bulk() ? 'Set project managers' : 'Change project managers',
  );
  protected readonly primaryChoice = signal(NONE);
  protected readonly secondaryChoice = signal(NONE);
  protected readonly eligible = signal<readonly MatterManagerItem[]>([]);
  protected readonly loadFailed = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly failed = signal<ManagersSaved['failed']>([]);
  protected readonly savedCount = signal(0);

  /** The choices of both pickers: a leading "Leave unchanged" (several matters) or "None", then every eligible person, then people who are on the matter but no longer eligible. */
  protected readonly options = computed(() => {
    const lead = this.bulk()
      ? [
          { value: KEEP, label: 'Leave unchanged' },
          { value: NONE, label: 'No project manager' },
        ]
      : [{ value: NONE, label: 'None' }];
    const seen = new Set<string>();
    const rows: { value: string; label: string }[] = [];
    for (const p of this.eligible()) {
      seen.add(String(p.userId));
      rows.push({ value: String(p.userId), label: nameWithAway(p) });
    }

    if (!this.bulk()) {
      // Somebody who is on the matter but has lost the role stays selectable, so opening the dialog never silently drops them.
      const t = this.targets()[0];
      for (const m of [t?.primary, t?.secondary]) {
        if (m && !seen.has(String(m.userId))) {
          seen.add(String(m.userId));
          rows.push({ value: String(m.userId), label: m.displayName });
        }
      }
    }

    return [...lead, ...rows];
  });

  protected readonly sameChosen = computed(() => {
    const [p, s] = [this.primaryChoice(), this.secondaryChoice()];
    return p !== NONE && p !== KEEP && p === s;
  });

  protected readonly canSave = computed(() => {
    if (this.failed().length > 0) return true;
    if (this.sameChosen() || this.loadFailed()) return false;
    if (this.bulk()) return this.primaryChoice() !== KEEP || this.secondaryChoice() !== KEEP;
    const t = this.targets()[0];
    return (
      !!t &&
      (this.primaryChoice() !== idOf(t.primary) || this.secondaryChoice() !== idOf(t.secondary))
    );
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.reset();
        void this.loadPeople();
      });
    });
  }

  private reset(): void {
    this.error.set('');
    this.failed.set([]);
    this.savedCount.set(0);
    this.busy.set(false);
    if (this.bulk()) {
      this.primaryChoice.set(KEEP);
      this.secondaryChoice.set(KEEP);
    } else {
      const t = this.targets()[0];
      this.primaryChoice.set(idOf(t?.primary ?? null));
      this.secondaryChoice.set(idOf(t?.secondary ?? null));
    }
  }

  private async loadPeople(): Promise<void> {
    this.loadFailed.set(false);
    try {
      this.eligible.set(
        await firstValueFrom(this.quiet.run(() => this.people.lookupMatterManagers(undefined, 50))),
      );
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) return;
    this.busy.set(true);
    this.error.set('');
    const pending = this.failed().length > 0 ? this.failed().map((f) => f.target) : this.targets();
    const updated: MatterResponse[] = [];
    const failed: { target: ManagerTarget; message: string }[] = [];
    const queue = [...pending];
    const worker = async (): Promise<void> => {
      for (let target = queue.shift(); target; target = queue.shift()) {
        try {
          updated.push(await this.apply(target));
        } catch (err) {
          failed.push({ target, message: reasonOf(err) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
    this.busy.set(false);
    this.savedCount.update((n) => n + updated.length);
    if (updated.length > 0) this.saved.emit({ updated, failed });
    if (failed.length === 0) {
      this.failed.set([]);
      this.visible.set(false);
      this.notify.success(
        this.bulk()
          ? `Project managers set on ${this.savedCount()} matters`
          : 'Project managers saved',
      );
      return;
    }

    // Matters that were saved are not changed again by "Try the rest again".
    this.failed.set(failed);
    if (failed.length === pending.length && !this.bulk()) this.error.set(failed[0].message);
  }

  private apply(target: ManagerTarget): Promise<MatterResponse> {
    const wanted = (choice: string, current: ManagerTarget['primary']): number | undefined =>
      choice === KEEP
        ? (current?.userId ?? undefined)
        : choice === NONE
          ? undefined
          : Number(choice);
    return firstValueFrom(
      this.quiet.run(() =>
        this.matters.setMatterManagers(target.matterId, {
          primaryManagerId: wanted(this.primaryChoice(), target.primary),
          secondaryManagerId: wanted(this.secondaryChoice(), target.secondary),
          rowVersion: target.rowVersion,
        }),
      ),
    );
  }
}

function idOf(person: { userId: number } | null): string {
  return person ? String(person.userId) : NONE;
}

function nameWithAway(p: MatterManagerItem): string {
  if (p.availability.state !== 'OUT_OF_OFFICE') return p.displayName;
  const until = p.availability.outUntil;
  return until
    ? `${p.displayName} (out of office until ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(until))})`
    : `${p.displayName} (out of office)`;
}

function reasonOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CONCURRENCY_CONFLICT')
      return 'it was changed by someone else; reload the list';
    const field = err.problem?.errors && Object.values(err.problem.errors)[0]?.[0]?.message;
    return field ?? err.message;
  }

  return 'it could not be saved';
}
