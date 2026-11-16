import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatterLookupClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakeMeApi, provideFakeMe, settle, withPermissions } from '../testing/org-testing';
import { LookupButton, LookupMessage, LookupNote } from './lookup-button';
import { MatterLookup } from './matter-lookup';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LookupButton, LookupNote],
  template: `
    <mf-lookup-button [busy]="busy()" [needs]="needs()" (lookup)="clicks = clicks + 1" />
    <mf-lookup-note [message]="message()" />
  `,
})
class Host {
  readonly busy = signal(false);
  readonly needs = signal('');
  readonly message = signal<LookupMessage | null>(null);
  clicks = 0;
}

describe('Lookup button (#1395)', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<Host>;
  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-lookup]');

  async function open(state: string | Error, permissions: Permission[] = []): Promise<void> {
    api = {
      getMatterLookupStatus: vi
        .fn()
        .mockReturnValue(state instanceof Error ? throwError(() => state) : of({ state })),
      searchMatterLookup: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MatterLookupClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(Host);
    await TestBed.inject(MatterLookup).refresh();
    await settle(fixture);
  }

  it('Ready: the button works and nothing is said under the field', async () => {
    await open('READY');

    expect(button().getAttribute('aria-disabled')).toBeNull();
    button().click();
    expect(fixture.componentInstance.clicks).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-lookup-unavailable]')).toBeNull();
  });

  it.each([
    ['NOT_SET_UP', "Lookup isn't available yet. Enter the details yourself."],
    ['DISABLED', 'Lookup is turned off. Enter the details yourself.'],
    ['FAILED', "Lookup isn't working right now. Enter the details yourself."],
  ])(
    '%s: the button stays, is disabled for everyone with a tooltip, and a sentence says the same',
    async (state, sentence) => {
      await open(state);

      expect(button()).not.toBeNull();
      expect(button().getAttribute('aria-disabled')).toBe('true');
      button().click();
      expect(fixture.componentInstance.clicks).toBe(0);
      expect(
        fixture.nativeElement
          .querySelector('[data-lookup-unavailable]')
          .textContent.replace(/\s+/g, ' '),
      ).toContain(sentence);
      expect(fixture.nativeElement.querySelector('[data-open-integrations]')).toBeNull(); // everyone else: no link
    },
  );

  it('an administrator also gets the Open Integrations link to the tab', async () => {
    await open('NOT_SET_UP', ['Integrations.Manage']);

    const link = fixture.nativeElement.querySelector(
      '[data-open-integrations]',
    ) as HTMLAnchorElement;
    expect(link.textContent!.trim()).toBe('Open Integrations');
    expect(link.getAttribute('href')).toBe('/admin/settings?tab=integrations');
  });

  it('a status that cannot be read keeps the button off rather than promising a lookup', async () => {
    await open(new Error('network'));

    expect(button().getAttribute('aria-disabled')).toBe('true');
  });

  it('a form that still needs input keeps it off with that reason, and a lookup that runs cannot be pressed again', async () => {
    await open('READY');
    fixture.componentInstance.needs.set('Enter a client number first.');
    await settle(fixture);
    expect(button().getAttribute('aria-disabled')).toBe('true');
    button().click();
    expect(fixture.componentInstance.clicks).toBe(0);

    fixture.componentInstance.needs.set('');
    fixture.componentInstance.busy.set(true);
    await settle(fixture);
    expect(button().textContent).toContain('Looking up...');
    button().click();
    expect(fixture.componentInstance.clicks).toBe(0);
  });

  it('shows the result of a lookup under the field; a failure offers Retry', async () => {
    await open('READY');
    fixture.componentInstance.message.set({
      kind: 'info',
      text: 'Nothing found for 00343. Enter the client name yourself.',
    });
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-lookup-message]').textContent).toContain(
      'Nothing found',
    );
    expect(fixture.nativeElement.querySelector('[data-lookup-retry]')).toBeNull();

    fixture.componentInstance.message.set({ kind: 'error', text: "Lookup didn't work." });
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-lookup-retry]')).not.toBeNull();
  });

  describe('MatterLookup service', () => {
    it('maps the answers to found, not found and failed, and never throws', async () => {
      await open('READY');
      const svc = TestBed.inject(MatterLookup);
      api['searchMatterLookup'].mockReturnValueOnce(
        of({ outcome: 'FOUND', clientName: 'Acme Corp', clientNumber: '00343' }),
      );
      expect(await svc.search('00343')).toEqual({
        kind: 'found',
        clientName: 'Acme Corp',
        clientNumber: '00343',
        matterName: undefined,
        matterNumber: undefined,
      });
      api['searchMatterLookup'].mockReturnValueOnce(of({ outcome: 'NOT_FOUND' }));
      expect(await svc.search('00343')).toEqual({ kind: 'not-found' });
      api['searchMatterLookup'].mockReturnValueOnce(of({ outcome: 'FAILED' }));
      expect(await svc.search('00343')).toEqual({ kind: 'failed' });
      api['searchMatterLookup'].mockReturnValueOnce(of({ outcome: 'NOT_AVAILABLE' }));
      expect(await svc.search('00343')).toEqual({ kind: 'failed' });
      api['searchMatterLookup'].mockReturnValueOnce(throwError(() => new Error('down')));
      expect(await svc.search('00343', '00012')).toEqual({ kind: 'failed' });
      expect(api['searchMatterLookup']).toHaveBeenLastCalledWith({
        clientNumber: '00343',
        matterNumber: '00012',
      });
    });
  });
});
