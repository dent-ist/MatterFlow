import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { OnHoldReasonView, OnHoldReasonsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { OnHoldReasonsPage } from './on-hold-reasons-page';

const reason = (id: number, name: string, isActive = true): OnHoldReasonView => ({
  id,
  name,
  sortOrder: id,
  isActive,
  rowVersion: `v${id}`,
});

describe('OnHoldReasonsPage (#876)', () => {
  let api: {
    listOnHoldReasons: ReturnType<typeof vi.fn>;
    updateOnHoldReason: ReturnType<typeof vi.fn>;
    createOnHoldReason: ReturnType<typeof vi.fn>;
    reorderOnHoldReasons: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<OnHoldReasonsPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const all = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = el()): T[] =>
    Array.from(root.querySelectorAll<T>(sel));
  const row = (name: string): HTMLElement =>
    el().querySelector<HTMLElement>(`[data-row="${name}"]`)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  async function open(...permissions: Permission[]): Promise<void> {
    api = {
      listOnHoldReasons: vi
        .fn()
        .mockReturnValue(
          of([
            reason(1, 'Waiting for client data'),
            reason(2, 'Waiting for approval'),
            reason(3, 'Waiting for vendor', false),
          ]),
        ),
      updateOnHoldReason: vi.fn(),
      createOnHoldReason: vi.fn(),
      reorderOnHoldReasons: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: OnHoldReasonsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(OnHoldReasonsPage);
    await settle();
  }

  const menuIds = (name: string): string[] =>
    all('[data-action]', row(name)).map((b) => b.getAttribute('data-action')!);

  async function openMenu(name: string): Promise<void> {
    row(name).querySelector<HTMLElement>('button[data-overflow]')!.click();
    await settle();
  }

  it('lists the reasons in order with their status and one menu per row', async () => {
    await open('OnHoldReason.Manage');
    expect(all('[data-row]').map((r) => r.getAttribute('data-row'))).toEqual([
      'Waiting for client data',
      'Waiting for approval',
      'Waiting for vendor',
    ]);
    expect(all('thead th').map((th) => th.textContent!.trim())).toEqual([
      'Order',
      'Name',
      'Status',
      'Actions',
    ]);
    expect(row('Waiting for vendor').textContent).toContain('Inactive');
    expect(all('mf-action-menu', row('Waiting for approval')).length).toBe(1);
  });

  it('offers Rename, the moves and Deactivate or Activate, and never Delete', async () => {
    await open('OnHoldReason.Manage');
    await openMenu('Waiting for approval');
    expect(menuIds('Waiting for approval')).toEqual(['rename', 'up', 'down', 'deactivate']);
    await openMenu('Waiting for vendor');
    expect(menuIds('Waiting for vendor')).toContain('activate');
    expect(menuIds('Waiting for vendor')).not.toContain('delete');
  });

  it('deactivates after a confirmation and sends the row version', async () => {
    await open('OnHoldReason.Manage');
    api.updateOnHoldReason.mockReturnValue(of(reason(2, 'Waiting for approval', false)));
    await openMenu('Waiting for approval');
    row('Waiting for approval').querySelector<HTMLElement>('[data-action="deactivate"]')!.click();
    await settle();
    const confirm = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.p-dialog button'),
    ).find((b) => b.textContent!.trim() === 'Deactivate reason')!;
    confirm.click();
    await settle();
    expect(api.updateOnHoldReason).toHaveBeenCalledWith(2, {
      name: 'Waiting for approval',
      isActive: false,
      rowVersion: 'v2',
    });
    expect(row('Waiting for approval').textContent).toContain('Inactive');
  });
});
