import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import { HOLIDAY_API } from './holiday-api';
import { ImportResult } from './holiday-contract';

/**
 * Paste or import a list of holidays (epic #1074, CAL-06): one holiday per line, a date (MM/DD/YYYY) or a range (MM/DD/YYYY - MM/DD/YYYY) and the name, a comma or a tab between them
 * (a copy from Excel works). Every change of the text asks the server for a dry run and shows a line-by-line result; nothing is saved until the person presses the import button.
 * Lines with a problem are skipped (and named), so the list can be fixed or imported without them.
 */
@Component({
  selector: 'mf-import-dialog',
  imports: [FormDialog, NumericDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      title="Import or paste holidays"
      [subtitle]="calendarName()"
      [primaryLabel]="importLabel()"
      size="large"
      [dirty]="text().trim().length > 0"
      [canSubmit]="(result()?.okCount ?? 0) > 0"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="visible"
      (submitted)="save()"
      data-import-dialog
    >
      <div class="im">
        <label class="im__l" for="im-text">One holiday per line: date, then the name</label>
        <textarea
          id="im-text"
          class="mf-control mf-control--fill im__t"
          rows="5"
          spellcheck="false"
          aria-describedby="im-help"
          [value]="text()"
          (input)="onText($any($event.target).value)"
        ></textarea>
        <p class="im__h" id="im-help">
          Dates as MM/DD/YYYY. A range as MM/DD/YYYY - MM/DD/YYYY. Copy from Excel works (a tab
          between date and name).
        </p>
        <label class="im__c">
          <input
            type="checkbox"
            [checked]="yearly()"
            (change)="setYearly($any($event.target).checked)"
          />
          Repeat every year (single days and ranges)
        </label>

        @if (result(); as r) {
          <div class="im__tw" role="region" aria-label="Check of the pasted lines" tabindex="0">
            <table class="im__tb" data-import-result>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Date(s)</th>
                  <th scope="col">Name</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                @for (l of r.lines; track l.line) {
                  <tr [class.im__bad]="!l.ok" [attr.data-line]="l.line">
                    <td>{{ l.line }}</td>
                    <td>
                      @if (l.parsed; as p) {
                        {{ p.date | mfNum }}
                        @if (p.endDate) {
                          to {{ p.endDate | mfNum }}
                        }
                      }
                    </td>
                    <td>{{ l.parsed?.name }}</td>
                    <td>
                      @if (l.ok) {
                        <span class="im__ok"
                          ><i class="pi pi-check" aria-hidden="true"></i> Ready</span
                        >
                      } @else {
                        <span class="im__no"
                          ><i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                          {{ l.message }}</span
                        >
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="im__s" role="status" data-import-summary>
            {{ r.okCount }} ready{{
              r.errorCount > 0 ? ', ' + r.errorCount + ' with a problem (skipped)' : ''
            }}.
          </p>
        }
      </div>
    </mf-form-dialog>
  `,
  styles: `
    .im {
      display: grid;
      gap: var(--mf-s2);
      padding: var(--mf-s1);
    }
    .im__l {
      font-weight: 600;
    }
    .im__t {
      min-height: 0;
      padding: var(--mf-s2) var(--mf-s3);
      font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
      resize: vertical;
    }
    .im__h {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .im__c {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .im__tw {
      max-height: 14rem;
      overflow: auto;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .im__tb {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mf-fs-sm);
    }
    .im__tb th,
    .im__tb td {
      padding: var(--mf-s1) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border-soft);
      text-align: left;
      vertical-align: top;
    }
    .im__tb th {
      position: sticky;
      top: 0;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-transform: uppercase;
    }
    .im__ok {
      color: var(--mf-sem-healthy-fg);
      font-weight: 600;
    }
    .im__no {
      color: var(--mf-sem-overdue-fg);
      font-weight: 600;
    }
    .im__s {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class ImportDialog {
  readonly visible = model(false);
  readonly calendarId = input.required<number>();
  readonly calendarName = input('');
  /** The year shown on the page (the lines of other years are saved as they are). */
  readonly year = input.required<number>();
  readonly saved = output<number>();

  private readonly api = inject(HOLIDAY_API);
  private readonly notify = inject(NotificationService);
  protected readonly text = signal('');
  protected readonly yearly = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.text.set('');
        this.yearly.set(false);
        this.result.set(null);
        this.error.set('');
        this.busy.set(false);
      });
    });
  }

  protected importLabel(): string {
    const n = this.result()?.okCount ?? 0;
    return n > 0 ? `Import ${n} ${n === 1 ? 'holiday' : 'holidays'}` : 'Import';
  }

  protected onText(value: string): void {
    this.text.set(value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), 250);
  }

  protected setYearly(value: boolean): void {
    this.yearly.set(value);
    void this.check();
  }

  private async check(): Promise<void> {
    const id = ++this.seq;
    if (!this.text().trim()) {
      this.result.set(null);
      return;
    }
    try {
      const r = await this.api.importLines(
        this.calendarId(),
        this.text(),
        this.year(),
        this.yearly(),
        true,
      );
      if (id === this.seq) {
        this.result.set(r);
        this.error.set('');
      }
    } catch {
      if (id === this.seq) this.error.set('The lines could not be checked. Try again.');
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || (this.result()?.okCount ?? 0) === 0) return;
    this.busy.set(true);
    try {
      const r = await this.api.importLines(
        this.calendarId(),
        this.text(),
        this.year(),
        this.yearly(),
        false,
      );
      this.notify.success('Holidays imported', `${r.okCount} added to ${this.calendarName()}.`, {
        key: 'holiday-import',
      });
      this.saved.emit(r.okCount);
      this.visible.set(false);
    } catch (err) {
      this.error.set(
        err instanceof ApiError ? err.message : 'The holidays could not be imported. Try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
