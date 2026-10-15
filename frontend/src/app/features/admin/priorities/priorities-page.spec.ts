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
import { PrioritiesPage } from './priorities-page';

describe('PrioritiesPage', () => {
  let api: FakePrioritiesClient;
  let fixture: ComponentFixture<PrioritiesPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const all = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = el()): T[] =>
    Array.from(root.querySelectorAll<T>(sel));
  const row = (label: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${label}"]`)!;
  const labels = (): string[] => all('[data-row]').map((r) => r.getAttribute('data-row')!);

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  /** A button inside the open confirm dialog (it renders in the page body, not in the component). */
  function dialogButton(label: string): HTMLButtonElement {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find(
      (b) => b.textContent!.trim() === label,
    )!;
  }

  async function click(target: Element | null): Promise<void> {
    (target as HTMLElement).click();
    await settle();
  }

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function open(...permissions: Permission[]): Promise<void> {
    api = new FakePrioritiesClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: PrioritiesClient, useValue: api },
        { provide: StatusLabelsClient, useValue: new FakeStatusLabelsClient() },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(PrioritiesPage);
    await settle();
  }

  describe('as a priority manager', () => {
    beforeEach(() => open('Priority.Manage'));

    it('lists the priorities most urgent first with badges, one default, and no numbers', () => {
      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low']);
      const radios = all<HTMLInputElement>('[data-default]');
      expect(radios.map((r) => r.checked)).toEqual([false, false, true, false]);
      expect(all('table mf-priority-badge [data-priority]').length).toBe(4);
      expect(el().querySelector('table')!.textContent).not.toMatch(/\b[1-9]\b/);
    });

    it('moves a row with the arrow buttons and saves the new order', async () => {
      expect(row('Critical').querySelector<HTMLButtonElement>('[data-move-up]')!.disabled).toBe(
        true,
      );
      expect(row('Low').querySelector<HTMLButtonElement>('[data-move-down]')!.disabled).toBe(true);

      await click(row('Critical').querySelector('[data-move-down]'));

      expect(api.calls).toContain('reorder:2,1,3,4');
      expect(labels()).toEqual(['High', 'Critical', 'Normal', 'Low']);
      expect(el().querySelector('[data-announce]')!.textContent).toContain(
        'Critical moved to position 2 of 4',
      );
    });

    it('reorders by drag and drop', async () => {
      row('Critical').dispatchEvent(new Event('dragstart', { bubbles: true }));
      row('Normal').dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      row('Normal').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
      await settle();

      expect(api.calls).toContain('reorder:2,3,1,4');
      expect(labels()).toEqual(['High', 'Normal', 'Critical', 'Low']);
    });

    it('restores the order and explains when saving the order fails', async () => {
      api.failNext = apiError(500, 'INTERNAL_ERROR', 'Server error');

      await click(row('High').querySelector('[data-move-up]'));

      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low']);
      expect(el().querySelector('[data-failure]')!.textContent).toContain('Server error');
    });

    it('renames inline and updates the shared lookups', async () => {
      await click(row('High').querySelector('[data-rename]'));
      const input = row('High').querySelector<HTMLInputElement>('[data-rename-input]')!;
      await type(input, 'Elevated');
      input.form!.dispatchEvent(new Event('submit'));
      await settle();

      expect(api.calls).toContain('update:2');
      expect(labels()).toContain('Elevated');
      expect(TestBed.inject(LookupStore).priority(2)?.label).toBe('Elevated');
      expect(el().querySelector('[data-rename-input]')).toBeNull();
    });

    it('rejects a blank label without calling the server and cancels with Escape', async () => {
      await click(row('High').querySelector('[data-rename]'));
      const input = row('High').querySelector<HTMLInputElement>('[data-rename-input]')!;
      await type(input, '   ');
      input.form!.dispatchEvent(new Event('submit'));
      await settle();

      expect(row('High').textContent).toContain('Enter a label.');
      expect(api.calls.filter((c) => c !== 'list')).toEqual([]);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(row('High').querySelector('[data-rename-input]')).toBeNull();
    });

    it('shows the server message when the label already exists', async () => {
      await click(row('High').querySelector('[data-rename]'));
      const input = row('High').querySelector<HTMLInputElement>('[data-rename-input]')!;
      await type(input, 'Low');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A priority named 'Low' exists.", {
        label: [{ code: 'DUPLICATE', message: "A priority named 'Low' exists." }],
      });
      input.form!.dispatchEvent(new Event('submit'));
      await settle();

      expect(row('High').textContent).toContain("A priority named 'Low' exists.");
      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low']);
    });

    it('makes another priority the single default', async () => {
      await click(row('High').querySelector('[data-default]'));

      expect(api.calls).toContain('default:2');
      expect(all<HTMLInputElement>('[data-default]').map((r) => r.checked)).toEqual([
        false,
        true,
        false,
        false,
      ]);
      expect(TestBed.inject(LookupStore).defaultPriority()?.label).toBe('High');
    });

    it('does not let the default be deactivated or deleted, but deactivates others and keeps showing them', async () => {
      expect(row('Normal').querySelector<HTMLInputElement>('[data-active]')!.disabled).toBe(true);
      expect(row('Normal').querySelector<HTMLButtonElement>('[data-delete]')!.disabled).toBe(true);

      await click(row('Low').querySelector('[data-active]'));

      expect(api.calls).toContain('update:4');
      expect(row('Low').textContent).toContain('Inactive');
      expect(row('Low').querySelector<HTMLInputElement>('[data-default]')!.disabled).toBe(true);
      expect(TestBed.inject(LookupStore).priority(4)?.isActive).toBe(false);
    });

    it('asks before deleting and explains when a priority is in use', async () => {
      await click(row('Low').querySelector('[data-delete]'));
      const dialog = document.body.querySelector('.p-dialog')!;
      expect(dialog.textContent).toContain('Delete priority?');
      expect(dialog.textContent).toContain('Low will be removed');

      // Keep priority closes the dialog and changes nothing.
      await click(dialogButton('Keep priority'));
      expect(api.calls).not.toContain('delete:4');
      expect(labels()).toContain('Low');

      await click(row('Low').querySelector('[data-delete]'));
      api.failNext = apiError(409, 'IN_USE', 'Tasks use this priority.');
      await click(dialogButton('Delete priority'));

      expect(labels()).toContain('Low');
      expect(el().querySelector('[data-failure]')!.textContent).toContain('Deactivate it instead');

      await click(row('Low').querySelector('[data-delete]'));
      await click(dialogButton('Delete priority'));
      expect(labels()).not.toContain('Low');
    });

    it('adds a priority at the end and previews its badge', async () => {
      const input = el().querySelector<HTMLInputElement>('[data-new-label]')!;
      await type(input, 'Whenever');
      expect(el().querySelector('.add mf-priority-badge')!.textContent).toContain('Whenever');

      input.form!.dispatchEvent(new Event('submit'));
      await settle();

      expect(api.calls).toContain('create');
      expect(labels()).toEqual(['Critical', 'High', 'Normal', 'Low', 'Whenever']);
      expect(input.value).toBe('');
    });

    it('requires a label and a readable custom color before adding', async () => {
      const form = el().querySelector<HTMLInputElement>('[data-new-label]')!.form!;
      form.dispatchEvent(new Event('submit'));
      await settle();
      expect(el().querySelector('[data-add-error]')!.textContent).toContain('Enter a label.');
      const field = el().querySelector<HTMLInputElement>('[data-new-label]')!;
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe('add-error');
      expect(el().querySelector('label[for="new-label"]')!.textContent).toContain('(required)');

      await type(el().querySelector<HTMLInputElement>('[data-new-label]')!, 'Muddy');
      const select = el().querySelector<HTMLSelectElement>('#new-color')!;
      select.value = 'custom';
      select.dispatchEvent(new Event('change'));
      await settle();
      const swatch = el().querySelector<HTMLInputElement>('input[type=color]')!;
      swatch.value = '#808080';
      swatch.dispatchEvent(new Event('input'));
      await settle();

      expect(el().querySelector('[data-contrast]')!.textContent).toContain('4.5:1 minimum');
      form.dispatchEvent(new Event('submit'));
      await settle();
      expect(api.calls).not.toContain('create');
    });

    it('reloads and says so on a concurrency conflict', async () => {
      api.failNext = apiError(409, 'CONCURRENCY_CONFLICT', 'Changed');
      const listsBefore = api.calls.filter((c) => c === 'list').length;

      await click(row('Low').querySelector('[data-active]'));

      expect(el().querySelector('[data-failure]')!.textContent).toContain('Someone else changed');
      expect(api.calls.filter((c) => c === 'list').length).toBe(listsBefore + 1);
    });
  });

  describe('without Priority.Manage', () => {
    beforeEach(() => open('Task.View'));

    it('is read-only: no add form, rename, delete, reorder or editable flags', () => {
      expect(labels().length).toBe(4);
      expect(el().querySelector('.add')).toBeNull();
      for (const attr of [
        'data-rename',
        'data-delete',
        'data-move-up',
        'data-move-down',
        'data-color',
      ]) {
        expect(el().querySelector(`[${attr}]`)).toBeNull();
      }
      expect(all<HTMLInputElement>('[data-active]').every((c) => c.disabled)).toBe(true);
      expect(all<HTMLInputElement>('[data-default]').every((c) => c.disabled)).toBe(true);
      expect(row('Critical').getAttribute('draggable')).toBe('false');
    });
  });
});
