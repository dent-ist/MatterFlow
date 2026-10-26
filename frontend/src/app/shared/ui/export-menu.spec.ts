import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NotificationService } from '../../core/notify/notification.service';
import { ExportMenu, ExportResult } from './export-menu';
import { ExportError } from './export.service';
import { ExportFormat } from './list-export';

@Component({
  imports: [ExportMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-export-menu
    [run]="run"
    fileName="demo"
    [disabled]="off()"
    reason="Nothing to export."
  />`,
})
class Host {
  readonly off = signal(false);
  run: (format: ExportFormat) => Promise<ExportResult> = vi.fn();
}

describe('ExportMenu', () => {
  function mount(run: (format: ExportFormat) => Promise<ExportResult>) {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.run = run;
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const open = async (f: ReturnType<typeof mount>) => {
    el(f).querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };
  const item = (f: ReturnType<typeof mount>, label: string) =>
    Array.from(el(f).querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((b) =>
      b.textContent?.includes(label),
    )!;

  it('is named as a list export and offers Download CSV and Copy as text', async () => {
    const f = mount(vi.fn());
    const trigger = el(f).querySelector('[data-overflow]')!;
    expect(trigger.getAttribute('aria-label')).toContain('not a status report');
    await open(f);
    expect(
      Array.from(el(f).querySelectorAll('[role=menuitem]')).map((b) => b.textContent!.trim()),
    ).toEqual(['Download CSV', 'Copy as text']);
  });

  it('copies the text and says how many rows', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    });
    const run = vi.fn().mockResolvedValue({ text: 'a\tb\n', rows: 1 });
    const f = mount(run);
    await open(f);
    item(f, 'Copy as text').click();
    await f.whenStable();
    f.detectChanges();
    expect(run).toHaveBeenCalledWith('text');
    expect(write).toHaveBeenCalledWith('a\tb\n');
    expect(el(f).querySelector('[data-export-status]')!.textContent).toContain('Copied 1 row.');
  });

  it('shows the refusal of the server as a toast and keeps quiet in the status line', async () => {
    const run = vi.fn().mockRejectedValue(new ExportError('This list has 12,400 tasks.'));
    const f = mount(run);
    await open(f);
    item(f, 'Download CSV').click();
    await f.whenStable();
    const notify = TestBed.inject(NotificationService);
    expect(notify.toasts().map((t) => t.detail)).toContain('This list has 12,400 tasks.');
    expect(el(f).querySelector('[data-export-status]')!.textContent).toBe('');
  });

  it('keeps the entries focusable but unavailable, with the reason, when there is nothing to export', async () => {
    const f = mount(vi.fn());
    f.componentInstance.off.set(true);
    f.detectChanges();
    await open(f);
    expect(item(f, 'Download CSV').getAttribute('aria-disabled')).toBe('true');
    expect(el(f).querySelector('[data-reason]')!.textContent).toContain('Nothing to export.');
  });
});
