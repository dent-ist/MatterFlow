import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NotificationService } from '../../core/notify/notification.service';
import { ActionMenu, MenuAction } from './action-menu';
import { ExportError } from './export.service';
import { ExportFormat, copyToClipboard, downloadText } from './list-export';

/** What a page's export function gives back: the document text and how many rows it holds. */
export interface ExportResult {
  text: string;
  rows: number;
}

/**
 * The Export menu (PM v2, #879): "Download CSV" and "Copy as text" for the list on screen. It is a list export, not a status report, and the menu
 * says so (its name and tooltip). The page supplies `run`, which returns the document for a format; the menu downloads or copies it and says
 * what happened (a status line that is read out, and a toast for a failure). The menu is the shared ARIA menu button: keyboard operable, no shortcut.
 * Lazy features only (it is used from lazy pages).
 */
@Component({
  selector: 'mf-export-menu',
  imports: [ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-action-menu
      [label]="help"
      triggerText="Export"
      [items]="items()"
      [floating]="true"
      data-export-menu
    />
    <span class="mf-sr-only" role="status" aria-live="polite" data-export-status>{{
      status()
    }}</span>
  `,
  styles: `
    :host {
      display: inline-block;
    }
  `,
})
export class ExportMenu {
  private readonly notify = inject(NotificationService);

  /** Builds the document for a format; may throw (an `ApiError` says why, for example "more than 10,000 tasks"). */
  readonly run = input.required<(format: ExportFormat) => Promise<ExportResult>>();
  readonly fileName = input('list');
  readonly disabled = input(false);
  /** Why the menu is unavailable (an empty list, a list still loading). */
  readonly reason = input('');

  protected readonly help = 'Export this list. This is a list export, not a status report.';
  protected readonly status = signal('');
  private readonly busy = signal(false);

  protected readonly items = computed<MenuAction[]>(() => {
    const off = this.disabled() || this.busy();
    const reason = this.disabled() ? this.reason() : '';
    return [
      {
        id: 'csv',
        label: 'Download CSV',
        icon: 'pi-download',
        disabled: off,
        reason,
        run: () => void this.go('csv'),
      },
      {
        id: 'copy',
        label: 'Copy as text',
        icon: 'pi-copy',
        disabled: off,
        reason,
        run: () => void this.go('text'),
      },
    ];
  });

  private async go(format: ExportFormat): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set(format === 'csv' ? 'Preparing the CSV.' : 'Preparing the text.');
    try {
      const result = await this.run()(format);
      const rows = `${result.rows} ${result.rows === 1 ? 'row' : 'rows'}`;
      if (format === 'csv') {
        downloadText(result.text, `${this.fileName()}.csv`, 'csv');
        this.status.set(`Downloaded ${rows}.`);
      } else if (await copyToClipboard(result.text)) {
        this.status.set(`Copied ${rows}.`);
      } else {
        this.status.set('');
        this.notify.error(
          'Could not copy',
          'The browser did not allow it. Download the CSV instead.',
        );
      }
    } catch (error) {
      this.status.set('');
      this.notify.error(
        'Could not export the list',
        error instanceof ExportError ? error.message : 'Try again in a moment.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
