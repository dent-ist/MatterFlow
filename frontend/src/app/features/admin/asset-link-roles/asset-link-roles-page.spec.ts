import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { AssetLinkRolesClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { FakeAssetLinkRolesClient, apiError } from '../../../core/lookups/lookups-testing';
import { AssetLinkRolesPage } from './asset-link-roles-page';

describe('AssetLinkRolesPage', () => {
  let api: FakeAssetLinkRolesClient;
  let fixture: ComponentFixture<AssetLinkRolesPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (name: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${name}"]`)!;
  const names = (): string[] =>
    Array.from(el().querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row')!);

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
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
    api = new FakeAssetLinkRolesClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AssetLinkRolesClient, useValue: api },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetLinkRolesPage);
    await settle();
  }

  describe('as an asset type manager', () => {
    beforeEach(() => open('AssetType.Manage'));

    it('lists the seeded roles in order', () => {
      expect(names()).toEqual(['Source', 'Destination', 'Subject', 'Result']);
    });

    it('adds a role and shows the duplicate message', async () => {
      const input = el().querySelector<HTMLInputElement>('[data-new-name]')!;
      await type(input, 'Related');
      input.form!.dispatchEvent(new Event('submit'));
      await settle();
      expect(names()).toEqual(['Source', 'Destination', 'Subject', 'Result', 'Related']);

      await type(input, 'source');
      api.failNext = apiError(409, 'DUPLICATE_NAME', "A link role named 'source' exists.", {
        name: [{ code: 'DUPLICATE', message: "A link role named 'source' exists." }],
      });
      input.form!.dispatchEvent(new Event('submit'));
      await settle();
      expect(el().querySelector('[data-add-error]')!.textContent).toContain(
        "A link role named 'source' exists.",
      );
    });

    it('renames inline', async () => {
      await click(row('Result').querySelector('[data-rename]'));
      const input = row('Result').querySelector<HTMLInputElement>('[data-rename-input]')!;
      await type(input, 'Output');
      input.form!.dispatchEvent(new Event('submit'));
      await settle();

      expect(names()).toContain('Output');
    });

    it('deactivates a role but keeps listing it', async () => {
      await click(row('Subject').querySelector('[data-active]'));

      expect(row('Subject').textContent).toContain('Inactive');
      expect(api.rows.find((r) => r.name === 'Subject')!.isActive).toBe(false);
    });

    it('reorders with the arrows and by drag and drop', async () => {
      await click(row('Destination').querySelector('[data-move-up]'));
      expect(names()).toEqual(['Destination', 'Source', 'Subject', 'Result']);

      row('Destination').dispatchEvent(new Event('dragstart', { bubbles: true }));
      row('Result').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
      await settle();
      expect(names()).toEqual(['Source', 'Subject', 'Result', 'Destination']);
    });

    it('deletes after confirmation and refuses a role that links use', async () => {
      await click(row('Result').querySelector('[data-delete]'));
      api.failNext = apiError(409, 'IN_USE', 'Links use this role.');
      await click(row('Result').querySelector('[data-confirm-delete] button'));
      expect(names()).toContain('Result');
      expect(el().querySelector('[data-failure]')!.textContent).toContain('Deactivate it instead');

      await click(row('Result').querySelector('[data-delete]'));
      await click(row('Result').querySelector('[data-confirm-delete] button'));
      expect(names()).not.toContain('Result');
    });
  });

  describe('without AssetType.Manage', () => {
    beforeEach(() => open('Task.View'));

    it('is read-only', () => {
      expect(names().length).toBe(4);
      for (const attr of ['data-rename', 'data-delete', 'data-move-up', 'data-new-name']) {
        expect(el().querySelector(`[${attr}]`)).toBeNull();
      }
    });
  });
});
