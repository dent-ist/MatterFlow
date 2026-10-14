import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { PrioritiesClient, StatusLabelsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { LookupStore } from '../../../core/lookups/lookup-store';
import {
  FakePrioritiesClient,
  FakeStatusLabelsClient,
  apiError,
} from '../../../core/lookups/lookups-testing';
import { StatusLabelsPage } from './status-labels-page';

describe('StatusLabelsPage', () => {
  let api: FakeStatusLabelsClient;
  let fixture: ComponentFixture<StatusLabelsPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (code: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${code}"]`)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  async function open(...permissions: Permission[]): Promise<void> {
    api = new FakeStatusLabelsClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: StatusLabelsClient, useValue: api },
        { provide: PrioritiesClient, useValue: new FakePrioritiesClient() },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(StatusLabelsPage);
    await settle();
  }

  async function edit(code: string, text: string): Promise<HTMLInputElement> {
    (row(code).querySelector('[data-rename]') as HTMLElement).click();
    await settle();
    const input = row(code).querySelector<HTMLInputElement>('[data-label-input]')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await settle();
    return input;
  }

  async function submit(input: HTMLInputElement): Promise<void> {
    input.form!.dispatchEvent(new Event('submit'));
    await settle();
  }

  describe('as a status label manager', () => {
    beforeEach(() => open('StatusLabel.Manage'));

    it('shows exactly the five fixed codes read-only with their labels and badges, and no add or delete', () => {
      const codes = Array.from(el().querySelectorAll('[data-row]')).map((r) =>
        r.getAttribute('data-row'),
      );
      expect(codes).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
      expect(row('ON_HOLD').querySelector('th.code')!.textContent).toBe('ON_HOLD');
      expect(row('ON_HOLD').querySelector('input[name=code]')).toBeNull();
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('On Hold');
      expect(el().textContent).toContain(
        "You can rename how statuses appear. You can't add or remove them.",
      );
      expect(el().querySelector('[data-delete]')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('button')).some((b) => /add/i.test(b.textContent ?? '')),
      ).toBe(false);
    });

    it('edits only the display label inline and keeps the code', async () => {
      const input = await edit('ON_HOLD', 'Waiting');
      expect(row('ON_HOLD').querySelector('mf-status-badge')!.textContent).toContain('Waiting'); // live preview

      await submit(input);

      expect(api.calls).toContain('update:ON_HOLD:Waiting');
      expect(row('ON_HOLD').querySelector('th.code')!.textContent).toBe('ON_HOLD');
      expect(row('ON_HOLD').textContent).toContain('Waiting');
      expect(TestBed.inject(LookupStore).statusLabel('ON_HOLD')).toBe('Waiting');
    });

    it('rejects a blank label and cancels with Escape', async () => {
      const input = await edit('NEW', '  ');
      await submit(input);
      expect(row('NEW').textContent).toContain('Enter a label.');
      expect(api.calls.filter((c) => c !== 'list')).toEqual([]);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(row('NEW').querySelector('[data-label-input]')).toBeNull();
      expect(row('NEW').textContent).toContain('New');
    });

    it('shows the duplicate-label message from the server', async () => {
      const input = await edit('NEW', 'Completed');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A status labelled 'Completed' exists.", {
        displayLabel: [{ code: 'DUPLICATE', message: "A status labelled 'Completed' exists." }],
      });

      await submit(input);

      expect(row('NEW').textContent).toContain("A status labelled 'Completed' exists.");
    });
  });

  describe('without StatusLabel.Manage', () => {
    beforeEach(() => open('Task.View'));

    it('is read-only', () => {
      expect(el().querySelectorAll('[data-row]').length).toBe(5);
      expect(el().querySelector('[data-rename]')).toBeNull();
    });
  });
});
