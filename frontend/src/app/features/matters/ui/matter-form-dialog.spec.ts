import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ClientsClient,
  MatterCategoriesClient,
  MatterTypesClient,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  aMatter,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterFormDialog } from './matter-form-dialog';
import { pickListItemsMulti } from './matter-form';

@Component({
  imports: [MatterFormDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-form-dialog
    [matter]="matter()"
    [(visible)]="open"
    (saved)="log.push($event.matterRef)"
  />`,
})
class Host {
  readonly matter = signal(aMatter());
  readonly open = signal(true);
  readonly log: string[] = [];
}

describe('MatterFormDialog: Edit Matter (MD-43, #1061; New Matter is a page since epic #1368)', () => {
  let matters: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const labels = (root: ParentNode) =>
    Array.from(root.querySelectorAll('.mf-label, .mf-field__label')).map((l) =>
      l
        .textContent!.replace(/\(required\)/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );

  async function start(matter = aMatter()) {
    matters = {
      updateMatter: vi.fn().mockReturnValue(ok(aMatter({ matterRef: '00343-00012' }))),
      getMatterCustomFieldForm: vi.fn().mockReturnValue(ok({})),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(
            withPermissions('Matter.View', 'Matter.Create', 'Matter.Edit', 'Matter.EditNumber'),
          ),
        ),
        { provide: MattersClient, useValue: matters },
        {
          provide: MatterTypesClient,
          useValue: {
            listMatterTypes: vi.fn().mockReturnValue(
              ok([
                {
                  id: 1,
                  name: 'Litigation',
                  sortOrder: 1,
                  isActive: true,
                  rowVersion: 'a',
                  inUseCount: 0,
                },
                {
                  id: 2,
                  name: 'Investigation',
                  sortOrder: 2,
                  isActive: true,
                  rowVersion: 'b',
                  inUseCount: 0,
                },
              ]),
            ),
          },
        },
        {
          provide: MatterCategoriesClient,
          useValue: {
            listMatterCategories: vi.fn().mockReturnValue(
              ok([
                {
                  id: 4,
                  name: 'Advisory',
                  sortOrder: 1,
                  isActive: true,
                  rowVersion: 'c',
                  inUseCount: 0,
                },
              ]),
            ),
          },
        },
        {
          provide: ClientsClient,
          useValue: {
            getClient: vi.fn().mockReturnValue(ok({})),
            listClients: vi.fn().mockReturnValue(ok({ items: [] })),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    f.componentInstance.matter.set(matter);
    await settle(f);
    return f;
  }

  it('is titled Edit Matter with the CM Number and holds the matter form fields in their order, Matter Types and Matter Category included', async () => {
    await start();
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Edit Matter');
    expect(q('.mf-formdlg')!.textContent).toContain('00343-00012');
    expect(labels(q('.mf-formdlg')!)).toEqual([
      'Client',
      'Matter Number',
      'CM Number',
      'Matter Name',
      'AI Allowed',
      'Matter Types',
      'Matter Category',
      'Current State',
      'DMS Path',
      'DFS Path',
    ]);
    expect(q('[data-panel-primary]')!.textContent).toContain('Save Changes');
  });

  it('opens at the default 576 px width, not the large 768 px (D-32, #1216)', async () => {
    await start();
    expect(q('.p-dialog')!.style.width).toBe('var(--mf-dialog-w)');
  });

  it('locks the client and the matter number and shows the CM Number as a read-only value', async () => {
    await start();
    expect((q('#matter-number') as HTMLInputElement).disabled).toBe(true);
    expect(q('[data-cm-value]')!.tagName).toBe('OUTPUT');
    expect(q('[data-cm-value]')!.textContent).toBe('00343-00012');
  });

  it('saves the Matter Types as a full set of ids and the Matter Category as one id', async () => {
    const f = await start(
      aMatter({
        matterTypes: [{ id: 1, name: 'Litigation', isActive: true }],
        matterCategory: { id: 4, name: 'Advisory', isActive: true },
      }),
    );
    // The control says what is chosen; a second type is added through the multi-select list.
    expect(q('#matter-type')!.textContent).toContain('Litigation');
    expect(q('#matter-category')!.textContent).toContain('Advisory');
    (q('#matter-type') as HTMLButtonElement).click();
    await settle(f);
    (
      document.body.querySelector('.dd-panel [role="option"][data-value="2"]') as HTMLElement
    ).click();
    await settle(f);
    expect(q('#matter-type')!.textContent).toContain('Litigation +1');
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(matters['updateMatter']).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ matterTypeIds: [1, 2], matterCategoryId: 4 }),
    );
    expect(f.componentInstance.log).toEqual(['00343-00012']);
  });

  it('clears the Matter Types when none is chosen (an empty list is the full value)', async () => {
    const f = await start(
      aMatter({ matterTypes: [{ id: 1, name: 'Litigation', isActive: true }] }),
    );
    (q('#matter-type') as HTMLButtonElement).click();
    await settle(f);
    (
      document.body.querySelector('.dd-panel [role="option"][data-value="1"]') as HTMLElement
    ).click();
    await settle(f);
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(matters['updateMatter']).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ matterTypeIds: [], matterCategoryId: undefined }),
    );
  });
});

describe('pickListItemsMulti: the choices of the Matter Types multi-select (epic #1368)', () => {
  const view = (id: number, name: string, sortOrder: number, isActive = true) => ({
    id,
    name,
    sortOrder,
    isActive,
    rowVersion: 'x',
    inUseCount: 0,
  });
  const list = [view(3, 'Arbitration', 3), view(1, 'Litigation', 1), view(2, 'Old', 2, false)];

  it('offers the active items in the administrator order and no Not Set row', () => {
    expect(pickListItemsMulti(list, [], [])).toEqual([
      { value: '1', label: 'Litigation' },
      { value: '3', label: 'Arbitration' },
    ]);
  });

  it('keeps a deactivated type the matter has, marked inactive, only while it stays chosen', () => {
    const current = [{ id: 2, name: 'Old', isActive: false }];
    expect(pickListItemsMulti(list, current, ['2'])[0]).toEqual({
      value: '2',
      label: 'Old (inactive)',
    });
    expect(pickListItemsMulti(list, current, []).map((i) => i.value)).toEqual(['1', '3']);
  });

  it('keeps a chosen type that the list could not be loaded for', () => {
    const current = [{ id: 7, name: 'Kept', isActive: true }];
    expect(pickListItemsMulti([], current, ['7'])).toEqual([{ value: '7', label: 'Kept' }]);
  });
});
