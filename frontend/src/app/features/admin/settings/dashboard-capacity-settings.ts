import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  DashboardCapacityAdminView,
  SettingsDashboardClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';

/**
 * Administration > Settings > Dashboard, the capacity battery (decision AV, DB-16 #1103): ONE choice, "Count people outside work hours as available" (default on). On, a person who is
 * only outside their work hours still has free slots, so the battery shows a percentage in the evening and at the weekend; off, the battery says "After hours" when nobody is at
 * work. Same form standard as the gauge form: the stored value, the default under the field, Save, Cancel and Reset to default, the version of what was read goes back with a save and a
 * stale version shows "Reload latest". Needs Settings.Manage (the Settings route).
 */
@Component({
  selector: 'mf-dashboard-capacity-settings',
  imports: [NumericDatePipe, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="cs" novalidate (submit)="$event.preventDefault(); save()" data-capacity-settings>
      <fieldset class="cs__group">
        <legend>Team Capacity</legend>
        <div class="mf-field">
          <label class="cs__check" for="cs-off-hours">
            <input
              id="cs-off-hours"
              type="checkbox"
              data-count-off-hours
              aria-describedby="cs-off-hours-help"
              [checked]="form()"
              (change)="patch($any($event.target).checked)"
            />
            Count people outside work hours as available
          </label>
          <p class="mf-field__help" id="cs-off-hours-help">
            On (the default): the Team capacity battery counts people who are only outside their
            work hours, so it shows a percentage in the evening. Off: it says After hours when
            nobody is at work. People who are out of office or on holiday are never counted.
          </p>
        </div>
      </fieldset>

      @if (serverMessage(); as m) {
        <div class="pg-alert" role="alert" data-capacity-server-error>
          {{ m }}
          @if (conflict()) {
            <p-button
              label="Reload Latest"
              severity="secondary"
              data-capacity-reload
              (onClick)="load()"
            />
          }
        </div>
      }
      @if (view(); as v) {
        @if (v.updatedAtUtc) {
          <p class="cs__meta" data-capacity-meta>
            Last Updated {{ v.updatedAtUtc | mfNum }}
            @if (v.updatedBy) {
              by {{ v.updatedBy }}
            }
          </p>
        }
      }

      <div class="cs__actions">
        <p-button
          type="button"
          label="Reset to Default"
          severity="secondary"
          [outlined]="true"
          data-capacity-reset
          [disabled]="busy() || isDefault()"
          (onClick)="reset()"
        />
        @if (!dirty()) {
          <p class="mf-form-actions__note" data-no-changes>No unsaved changes</p>
        } @else {
          <span class="mf-form-actions__note"></span>
        }
        <p-button
          type="button"
          label="Cancel"
          severity="secondary"
          data-capacity-cancel
          [disabled]="busy() || !dirty()"
          (onClick)="cancel()"
        />
        <p-button
          type="submit"
          [label]="busy() ? 'Saving...' : 'Save Changes'"
          data-capacity-save
          [disabled]="busy() || !dirty()"
        />
      </div>
      <p class="sr-only" role="status" aria-live="polite" data-capacity-live>{{ live() }}</p>
    </form>
  `,
  styles: `
    :host {
      display: block;
      margin-top: var(--mf-s4);
    }
    .cs {
      display: grid;
      gap: var(--mf-s4);
      max-width: 720px;
      min-width: 0;
    }
    .cs__group {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
      margin: 0;
      padding: 0 0 var(--mf-s4);
      border: 0;
      border-bottom: 1px solid var(--mf-border);
    }
    /* A section heading: 16 / 600, the card rule (D-11, #1156). */
    legend {
      padding: 0;
      margin-bottom: var(--mf-s2);
      font-size: var(--mf-fs-lg);
      font-weight: var(--mf-fw-semibold);
    }
    .cs__check {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 24px;
      font-weight: 600;
    }
    .cs__meta {
      margin: 0;
      color: var(--mf-text-muted);
    }
    /* [Reset] [No unsaved changes] ... [Cancel] [Save Changes]: the primary last (D-30, #1156). */
    .cs__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
      justify-content: flex-end;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class DashboardCapacitySettings implements OnInit {
  private readonly api = inject(SettingsDashboardClient);
  private readonly notify = inject(NotificationService);

  protected readonly view = signal<DashboardCapacityAdminView | null>(null);
  protected readonly conflict = signal(false);
  private readonly saved = signal(true);
  protected readonly form = signal(true);
  protected readonly busy = signal(false);
  protected readonly live = signal('');
  protected readonly serverMessage = signal<string | null>(null);

  protected readonly defaultValue = computed(() => this.view()?.defaultCountOffHours ?? true);
  protected readonly dirty = computed(() => this.form() !== this.saved());
  protected readonly isDefault = computed(() => this.form() === this.defaultValue());

  ngOnInit(): void {
    void this.load();
  }

  /** Reads the setting (also "Reload latest" after a version conflict). */
  protected async load(): Promise<void> {
    try {
      this.applyView(await firstValueFrom(this.api.getDashboardCapacitySettings()));
      this.conflict.set(false);
    } catch {
      this.serverMessage.set("Couldn't load the capacity setting. Try again.");
    }
  }

  private applyView(view: DashboardCapacityAdminView): void {
    this.view.set(view);
    this.saved.set(view.countOffHours);
    this.form.set(view.countOffHours);
    this.serverMessage.set(null);
  }

  protected patch(value: boolean): void {
    this.form.set(value);
    this.serverMessage.set(null);
  }

  protected reset(): void {
    this.patch(this.defaultValue());
    this.live.set('Default filled in. Save to keep it.');
  }

  protected cancel(): void {
    this.form.set(this.saved());
    this.serverMessage.set(null);
    this.live.set('Changes discarded.');
  }

  protected async save(): Promise<void> {
    const view = this.view();
    if (!view || this.busy() || !this.dirty()) return;
    this.busy.set(true);
    try {
      // Back to the default is a reset (the stored value goes away); anything else stores the value. The version of what was read goes back with it.
      const next =
        this.form() === this.defaultValue() && view.isCustom
          ? await firstValueFrom(this.api.resetDashboardCapacitySettings(view.rowVersion))
          : await firstValueFrom(
              this.api.setDashboardCapacitySettings({
                countOffHours: this.form(),
                rowVersion: view.isCustom ? view.rowVersion : '',
              }),
            );
      this.applyView(next);
      this.notify.success(
        'Capacity setting saved',
        'The capacity battery uses the new rule the next time it refreshes.',
      );
      this.live.set('Capacity setting saved.');
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.code === 'CONCURRENCY_CONFLICT')
      ) {
        this.conflict.set(true);
        this.serverMessage.set(
          'Someone else changed this setting while you were editing. Reload to see the latest value; your change here is not saved.',
        );
      } else {
        this.serverMessage.set(
          error instanceof ApiError ? error.message : "Couldn't save the setting. Try again.",
        );
      }
    } finally {
      this.busy.set(false);
    }
  }
}
