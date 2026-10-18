import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiError } from '../../core/http/api-error';
import {
  RecordKind,
  RecordLoadState,
  RecordState,
  recordFailureOf,
  recordStateText,
} from './record-state';

const apiError = (status: number) => ApiError.from(new HttpErrorResponse({ status, error: {} }));

describe('record load states (#246)', () => {
  it('maps the status to a state: 404 not found, 403 forbidden, everything else a failure to retry', () => {
    expect(recordFailureOf(apiError(404))).toBe('notFound');
    expect(recordFailureOf(apiError(403))).toBe('forbidden');
    expect(recordFailureOf(apiError(500))).toBe('error');
    expect(recordFailureOf(apiError(503))).toBe('error');
    expect(recordFailureOf(apiError(0))).toBe('error'); // lost connection
    expect(recordFailureOf(apiError(409))).toBe('error');
    expect(recordFailureOf(new Error('timeout'))).toBe('error');
    expect(recordFailureOf(undefined)).toBe('error');
  });

  it('has one wording per state for all three records', () => {
    const kinds: RecordKind[] = ['client', 'matter', 'project'];
    for (const kind of kinds) {
      expect(recordStateText(kind, 'notFound')).toBe(`We couldn't find that ${kind}.`);
      expect(recordStateText(kind, 'forbidden')).toBe(`You don't have access to this ${kind}.`);
      expect(recordStateText(kind, 'error')).toBe(`Couldn't load this ${kind}.`);
    }
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecordState],
  template: `<mf-record-state
    [kind]="kind()"
    recordId="99999"
    [state]="state()"
    [busy]="busy()"
    (retried)="retries = retries + 1"
  />`,
})
class Host {
  readonly kind = signal<RecordKind>('client');
  readonly state = signal<RecordLoadState>('notFound');
  readonly busy = signal(false);
  retries = 0;
}

describe('mf-record-state', () => {
  async function render() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, el, host: fixture.componentInstance, settle };
  }

  it('shows the not-found text, the crumb and a link to the list, without Retry', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain("We couldn't find that client.");
    expect(el.querySelector('nav[aria-label=Breadcrumb]')?.textContent).toContain('Clients');
    expect(el.querySelector('nav[aria-label=Breadcrumb]')?.textContent).toContain('Client 99999');
    expect(el.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/clients');
    expect(el.querySelector('[data-retry]')).toBeNull();
  });

  it('shows the access text without Retry for a 403', async () => {
    const { el, host, settle } = await render();
    host.kind.set('matter');
    host.state.set('forbidden');
    await settle();
    expect(el.querySelector('h1')?.textContent).toContain("You don't have access to this matter.");
    expect(el.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/matters');
    expect(el.querySelector('[data-retry]')).toBeNull();
  });

  it('shows "Couldn\'t load" with Retry for a failure, and Retry asks the page to load again', async () => {
    const { el, host, settle } = await render();
    host.kind.set('project');
    host.state.set('error');
    await settle();
    expect(el.querySelector('h1')?.textContent).toContain("Couldn't load this project.");
    expect(el.querySelector('[data-back-link]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!.click();
    expect(host.retries).toBe(1);
  });

  it('ignores Retry while a retry is running and keeps the button where it is', async () => {
    const { el, host, settle } = await render();
    host.state.set('error');
    host.busy.set(true);
    await settle();
    const button = el.querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!;
    expect(button.disabled).toBe(false); // still focusable
    button.click();
    expect(host.retries).toBe(0);
  });
});
