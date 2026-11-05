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
  DashboardSettingsAdminView,
  SettingsDashboardClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  DEFAULT_GAUGE_SETTINGS,
  GaugeSettings,
  WEEKDAYS,
  fromServer,
  WEEKDAY_LABELS,
  Weekday,
  sameSettings,
  validateGaugeSettings,
} from './dashboard-settings-model';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';

/**
 * Administration > Settings > Dashboard (epic #1063, DB-06): the working hours and levels of the unassigned gauge. Workday start and end, the working days, the age basis
 * (working hours or clock hours), the hours for levels 1 to 5 and the tasks per extra level, with the defaults shown under each field and a Reset to default that only fills
 * the form; nothing changes until Save. The server checks the values again and its messages sit under the field. Needs Settings.Manage (the Settings route).
 */
@Component({
  selector: 'mf-dashboard-settings',
  imports: [NumericDatePipe, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="ds" novalidate (submit)="$event.preventDefault(); save()" data-dashboard-settings>
      <p class="ds__intro">
        The unassigned gauge on the Dashboard counts how long the oldest unassigned task has waited.
        These settings decide which hours count and where the levels start.
      </p>

      <fieldset class="ds__group" data-group="hours">
        <legend>Working hours</legend>
        <div class="ds__row">
          <div class="mf-field">
            <label class="mf-field__label" for="ds-start">Workday starts</label>
            <input
              id="ds-start"
              class="mf-field__input"
              type="time"
              [value]="form().workdayStart"
              [attr.aria-invalid]="errors()['workdayStart'] ? 'true' : null"
              [attr.aria-describedby]="
                'ds-start-help' + (errors()['workdayStart'] ? ' ds-start-err' : '')
              "
              (input)="patch({ workdayStart: $any($event.target).value })"
            />
            <p class="mf-field__help" id="ds-start-help">
              Default {{ defaultSettings().workdayStart }}
            </p>
            @if (errors()['workdayStart']; as e) {
              <p class="mf-field__error" role="alert" id="ds-start-err">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
          <div class="mf-field">
            <label class="mf-field__label" for="ds-end">Workday ends</label>
            <input
              id="ds-end"
              class="mf-field__input"
              type="time"
              [value]="form().workdayEnd"
              [attr.aria-invalid]="errors()['workdayEnd'] ? 'true' : null"
              [attr.aria-describedby]="
                'ds-end-help' + (errors()['workdayEnd'] ? ' ds-end-err' : '')
              "
              (input)="patch({ workdayEnd: $any($event.target).value })"
            />
            <p class="mf-field__help" id="ds-end-help">
              Default {{ defaultSettings().workdayEnd }}
            </p>
            @if (errors()['workdayEnd']; as e) {
              <p class="mf-field__error" role="alert" id="ds-end-err">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
        </div>
        <div
          class="mf-field"
          role="group"
          aria-labelledby="ds-days-l"
          aria-describedby="ds-days-help"
        >
          <span class="mf-field__label" id="ds-days-l">Working days</span>
          <div class="ds__days">
            @for (d of weekdays; track d) {
              <label class="ds__day">
                <input
                  type="checkbox"
                  [checked]="form().workDays.includes(d)"
                  [attr.data-day]="d"
                  (change)="toggleDay(d, $any($event.target).checked)"
                />
                {{ dayLabels[d] }}
              </label>
            }
          </div>
          <p class="mf-field__help" id="ds-days-help">
            Default Monday to Friday. The firm's time zone applies to everyone.
          </p>
          @if (errors()['workDays']; as e) {
            <p class="mf-field__error" role="alert" data-error="workDays">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
        <div class="mf-field" role="radiogroup" aria-labelledby="ds-basis-l">
          <span class="mf-field__label" id="ds-basis-l">Age is counted in</span>
          <label class="ds__day">
            <input
              type="radio"
              name="ds-basis"
              value="WORKING"
              data-basis="WORKING"
              [checked]="form().ageBasis === 'WORKING'"
              (change)="patch({ ageBasis: 'WORKING' })"
            />
            Working hours
          </label>
          <label class="ds__day">
            <input
              type="radio"
              name="ds-basis"
              value="CLOCK"
              data-basis="CLOCK"
              [checked]="form().ageBasis === 'CLOCK'"
              (change)="patch({ ageBasis: 'CLOCK' })"
            />
            Clock hours
          </label>
          <p class="mf-field__help">
            Default working hours: a task created at 5:55 PM is not critical at 8 AM.
          </p>
        </div>
      </fieldset>

      <fieldset class="ds__group" data-group="levels">
        <legend>Levels</legend>
        <div class="mf-field" role="group" aria-labelledby="ds-lv-l" aria-describedby="ds-lv-help">
          <span class="mf-field__label" id="ds-lv-l">Hours of waiting for levels 1 to 5</span>
          <div class="ds__levels">
            @for (h of form().levelHours; track $index) {
              <label class="ds__lv">
                <span class="mf-field__label">Level {{ $index + 1 }}</span>
                <input
                  class="mf-field__input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  inputmode="decimal"
                  [value]="h"
                  [attr.data-level-hours]="$index + 1"
                  [attr.aria-invalid]="errors()['levelHours'] ? 'true' : null"
                  (input)="setLevelHours($index, $any($event.target).value)"
                />
              </label>
            }
          </div>
          <p class="mf-field__help" id="ds-lv-help">
            Default 1, 2, 3, 4 and 5 hours. Under the first level the gauge says Normal.
          </p>
          @if (errors()['levelHours']; as e) {
            <p class="mf-field__error" role="alert" data-error="levelHours">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
            </p>
          }
        </div>
        <div class="ds__row">
          <div class="mf-field">
            <label class="mf-field__label" for="ds-per">Unassigned tasks per extra level</label>
            <input
              id="ds-per"
              class="mf-field__input"
              type="number"
              min="1"
              step="1"
              [value]="form().tasksPerLevel"
              [attr.aria-invalid]="errors()['tasksPerLevel'] ? 'true' : null"
              [attr.aria-describedby]="
                'ds-per-help' + (errors()['tasksPerLevel'] ? ' ds-per-err' : '')
              "
              (input)="patch({ tasksPerLevel: toInt($any($event.target).value) })"
            />
            <p class="mf-field__help" id="ds-per-help">
              Default {{ defaultSettings().tasksPerLevel }}: every
              {{ defaultSettings().tasksPerLevel }} waiting tasks add one level.
            </p>
            @if (errors()['tasksPerLevel']; as e) {
              <p class="mf-field__error" role="alert" id="ds-per-err">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
          <div class="mf-field">
            <label class="mf-field__label" for="ds-bonus">Most extra levels from the count</label>
            <input
              id="ds-bonus"
              class="mf-field__input"
              type="number"
              min="0"
              max="5"
              step="1"
              [value]="form().countBonusMax"
              [attr.aria-invalid]="errors()['countBonusMax'] ? 'true' : null"
              [attr.aria-describedby]="
                'ds-bonus-help' + (errors()['countBonusMax'] ? ' ds-bonus-err' : '')
              "
              (input)="patch({ countBonusMax: toInt($any($event.target).value) })"
            />
            <p class="mf-field__help" id="ds-bonus-help">
              Default {{ defaultSettings().countBonusMax }}. The level never goes above 5.
            </p>
            @if (errors()['countBonusMax']; as e) {
              <p class="mf-field__error" role="alert" id="ds-bonus-err">
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
              </p>
            }
          </div>
        </div>
      </fieldset>

      @if (serverMessage(); as m) {
        <div class="pg-alert" role="alert" data-server-error>
          {{ m }}
          @if (conflict()) {
            <p-button label="Reload latest" severity="secondary" data-reload (onClick)="load()" />
          }
        </div>
      }
      @if (view(); as v) {
        <p class="ds__intro" data-ds-meta>
          Times are in the firm's time zone ({{ v.timeZoneId }}), for everyone.
          @if (v.updatedAtUtc) {
            Last changed {{ v.updatedAtUtc | mfNum }}
            @if (v.updatedBy) {
              by {{ v.updatedBy }}
            }
          }
        </p>
      }

      <div class="ds__actions mf-form-actions--sticky">
        <p-button
          type="button"
          label="Reset to default"
          severity="secondary"
          [outlined]="true"
          data-reset
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
          data-cancel
          [disabled]="busy() || !dirty()"
          (onClick)="cancel()"
        />
        <p-button
          type="submit"
          [label]="busy() ? 'Saving...' : 'Save Changes'"
          data-save
          [disabled]="busy() || !dirty() || hasErrors()"
        />
      </div>
      <p class="sr-only" role="status" aria-live="polite" data-ds-live>{{ live() }}</p>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }
    .ds {
      display: grid;
      gap: var(--mf-s4);
      max-width: 720px;
      min-width: 0;
    }
    .ds__intro {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ds__group {
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
    .ds__row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s4);
    }
    .ds__row > .mf-field {
      flex: 1 1 14rem;
    }
    .ds__days,
    .ds__levels {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
    }
    .ds__day {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 24px;
    }
    .ds__lv {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s1);
      width: 6rem;
    }
    .ds__lv .mf-field__input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
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
export class DashboardSettings implements OnInit {
  private readonly api = inject(SettingsDashboardClient);
  private readonly notify = inject(NotificationService);

  protected readonly weekdays = WEEKDAYS;
  protected readonly dayLabels = WEEKDAY_LABELS;
  protected readonly defaults = DEFAULT_GAUGE_SETTINGS;
  /** The server's answer: the stored values, the defaults, the version to send back and the firm's time zone. */
  protected readonly view = signal<DashboardSettingsAdminView | null>(null);
  protected readonly conflict = signal(false);
  protected readonly defaultSettings = computed(() => {
    const v = this.view();
    return v ? fromServer(v.defaults) : DEFAULT_GAUGE_SETTINGS;
  });

  private readonly saved = signal<GaugeSettings>(structuredClone(DEFAULT_GAUGE_SETTINGS));
  protected readonly form = signal<GaugeSettings>(structuredClone(DEFAULT_GAUGE_SETTINGS));
  protected readonly busy = signal(false);
  protected readonly live = signal('');
  /** The server's messages by field, after a save it refused; cleared on the next edit of that field. */
  private readonly serverErrors = signal<Record<string, string>>({});
  protected readonly serverMessage = signal<string | null>(null);

  protected readonly errors = computed(() => ({
    ...validateGaugeSettings(this.form()),
    ...this.serverErrors(),
  }));
  protected readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);
  protected readonly dirty = computed(() => !sameSettings(this.form(), this.saved()));
  protected readonly isDefault = computed(() => sameSettings(this.form(), this.defaultSettings()));

  ngOnInit(): void {
    void this.load();
  }

  /** Reads the settings (also "Reload latest" after a version conflict). */
  protected async load(): Promise<void> {
    try {
      const view = await firstValueFrom(this.api.getDashboardSettings());
      this.applyView(view);
      this.conflict.set(false);
    } catch {
      this.serverMessage.set("We couldn't load the settings. Try again.");
    }
  }

  private applyView(view: DashboardSettingsAdminView): void {
    const gauge = fromServer(view.gauge);
    this.view.set(view);
    this.saved.set(structuredClone(gauge));
    this.form.set(structuredClone(gauge));
    this.serverErrors.set({});
    this.serverMessage.set(null);
  }

  protected patch(change: Partial<GaugeSettings>): void {
    this.form.update((f) => ({ ...f, ...change }));
    this.serverErrors.set({});
    this.serverMessage.set(null);
  }

  protected toggleDay(day: Weekday, on: boolean): void {
    const days = new Set(this.form().workDays);
    if (on) days.add(day);
    else days.delete(day);
    this.patch({ workDays: WEEKDAYS.filter((d) => days.has(d)) });
  }

  protected setLevelHours(index: number, raw: string): void {
    const hours = [...this.form().levelHours];
    hours[index] = raw === '' ? Number.NaN : Number(raw);
    this.patch({ levelHours: hours });
  }

  protected toInt(raw: string): number {
    return raw === '' ? Number.NaN : Number(raw);
  }

  protected reset(): void {
    this.patch(structuredClone(this.defaultSettings()));
    this.live.set('Defaults filled in. Save to keep them.');
  }

  protected cancel(): void {
    this.form.set(structuredClone(this.saved()));
    this.serverErrors.set({});
    this.serverMessage.set(null);
    this.live.set('Changes discarded.');
  }

  protected async save(): Promise<void> {
    const view = this.view();
    if (!view || this.busy() || this.hasErrors() || !this.dirty()) return;
    this.busy.set(true);
    try {
      // Back to the defaults is a reset (the stored value goes away); anything else stores the values. The version of what was read goes back with it.
      const toDefaults = sameSettings(this.form(), this.defaultSettings());
      const next =
        toDefaults && view.isCustom
          ? await firstValueFrom(this.api.resetDashboardSettings(view.rowVersion))
          : await firstValueFrom(
              this.api.setDashboardSettings({
                gauge: this.form(),
                rowVersion: view.isCustom ? view.rowVersion : '',
              }),
            );
      this.applyView(next);
      this.notify.success(
        'Dashboard settings saved',
        'The gauge uses the new hours the next time it refreshes.',
      );
      this.live.set('Dashboard settings saved.');
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.code === 'CONCURRENCY_CONFLICT')
      ) {
        this.conflict.set(true);
        this.serverMessage.set(
          'Someone else changed these settings while you were editing. Reload to see the latest values; your changes here are not saved.',
        );
      } else {
        if (error instanceof ApiError && error.hasFieldErrors) {
          // The server's messages go under the field they name (the first one of each); a field the form does not know shows above the buttons.
          const named: Record<string, string> = {};
          for (const [field, list] of Object.entries(error.problem?.errors ?? {})) {
            const key = field.charAt(0).toLowerCase() + field.slice(1);
            if (list[0]) named[key] = list[0].message;
          }
          this.serverErrors.set(named);
        }
        this.serverMessage.set(
          error instanceof ApiError ? error.message : "We couldn't save the settings. Try again.",
        );
      }
    } finally {
      this.busy.set(false);
    }
  }
}
