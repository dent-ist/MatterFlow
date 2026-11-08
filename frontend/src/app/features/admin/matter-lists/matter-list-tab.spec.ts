import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatterListItemView, MatterTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import {
  MATTER_LIST_TEXTS,
  MatterListTab,
  deactivateBody,
  duplicateMessage,
} from './matter-list-tab';
import { MATTER_LIST_TABS } from './matter-lists-tabs';

const item = (
  id: number,
  name: string,
  over: Partial<MatterListItemView> = {},
): MatterListItemView => ({
  id,
  name,
  sortOrder: id,
  isActive: true,
  rowVersion: `RV${id}`,
  inUseCount: 0,
  ...over,
});

describe('Matter Lists wording (UI spec 7.3)', () => {
  const types = MATTER_LIST_TEXTS['matter-types'];
  const titles = MATTER_LIST_TEXTS['team-titles'];

  it('words the Deactivate confirm by what carries the item', () => {
    expect(deactivateBody(types, 12)).toBe(
      "12 matters keep this type. It won't be offered for new or changed matters. You can activate it again.",
    );
    expect(deactivateBody(types, 1)).toContain('1 matter keeps this type.');
    expect(deactivateBody(types, 0)).toBe(
      "No matters use this type. It won't be offered for new or changed matters. You can activate it again.",
    );
    expect(deactivateBody(MATTER_LIST_TEXTS['current-states'], 3)).toContain('keep this state.');
    expect(deactivateBody(titles, 4)).toBe(
      "4 team members keep this title. It won't be offered for new or changed team members. You can activate it again.",
    );
  });

  it('words the duplicate name, with the activate hint for an inactive duplicate', () => {
    expect(duplicateMessage(types, 'Litigation', false)).toBe(
      "A matter type named 'Litigation' already exists.",
    );
    expect(duplicateMessage(MATTER_LIST_TEXTS['current-states'], 'Startup', false)).toBe(
      "A current state named 'Startup' already exists.",
    );
    expect(duplicateMessage(titles, 'Attorney', true)).toBe(
      "A team title named 'Attorney' already exists. It is inactive; activate it instead.",
    );
  });

  it('has three tabs on one permission, in the specified order', () => {
    expect(MATTER_LIST_TABS.map((t) => t.label)).toEqual([
      'Matter Types',
      'Current States',
      'Team Titles',
    ]);
    for (const t of MATTER_LIST_TABS) expect(t.permission).toEqual(['MatterList.Manage']);
    expect(types.newButton).toBe('New Matter Type');
    expect(MATTER_LIST_TEXTS['current-states'].newButton).toBe('New State');
    expect(titles.newButton).toBe('New Title');
  });
});

@Component({
  imports: [MatterListTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-list-tab kind="matter-types" />`,
})
class Host {
  readonly unused = signal(0);
}

describe('MatterListTab (Matter Types)', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));

  async function start(list: MatterListItemView[] | 'error', manage = true) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    api = {
      listMatterTypes: vi
        .fn()
        .mockReturnValue(list === 'error' ? apiError(500, { code: 'INTERNAL' }) : ok(list)),
      createMatterType: vi.fn().mockReturnValue(ok(item(9, 'Antitrust'))),
      updateMatterType: vi
        .fn()
        .mockImplementation((_id: number, b: { name: string; isActive: boolean }) =>
          ok(item(1, b.name, { isActive: b.isActive, rowVersion: 'RV-new' })),
        ),
      deleteMatterType: vi.fn().mockReturnValue(ok(undefined)),
      reorderMatterTypes: vi
        .fn()
        .mockImplementation((b: { ids: number[] }) =>
          ok(b.ids.map((id, i) => item(id, `T${id}`, { sortOrder: i + 1 }))),
        ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(withPermissions(...(manage ? ['MatterList.Manage' as const] : []))),
        ),
        { provide: MatterTypesClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    document.body.appendChild(f.nativeElement);
    await settle(f);
    return f;
  }

  const menu = async (f: Awaited<ReturnType<typeof start>>, row: string) => {
    (q(`[data-row="${row}"] [data-overflow]`) as HTMLElement).click();
    await settle(f);
    return all('[role=menuitem]').map((m) =>
      m
        .textContent!.replace(/\s+/g, ' ')
        .trim()
        .replace(/ Already (first|last)\.$/, ''),
    );
  };

  it('lists the items in order with In Use, a link to the Matters list, and Status', async () => {
    await start([
      item(1, 'Litigation', { inUseCount: 12 }),
      item(2, 'Advisory', { isActive: false }),
    ]);
    expect(
      all('th')
        .map((t) => t.textContent!.trim())
        .filter(Boolean),
    ).toEqual(['Order', 'Matter Type', 'Matters', 'Status', 'Actions']);
    const link = q('[data-row="Litigation"] [data-in-use] a')!;
    expect(link.textContent!.trim()).toBe('12');
    expect(link.getAttribute('href')).toContain('/matters?matterTypeId=1');
    expect(q('[data-row="Advisory"] [data-in-use]')!.textContent!.trim()).toBe('0');
    expect(q('[data-row="Advisory"]')!.classList.contains('inactive')).toBe(true);
  });

  it('offers Delete only on a row that is not in use', async () => {
    const f = await start([item(1, 'Litigation', { inUseCount: 2 }), item(2, 'Typo')]);
    expect(await menu(f, 'Litigation')).toEqual(['Rename', 'Move Up', 'Move Down', 'Deactivate']);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle(f);
    const unused = await menu(f, 'Typo');
    expect(unused[unused.length - 1]).toBe('Delete');
  });

  it('asks before deactivating, with the count in the sentence, then saves isActive false', async () => {
    const f = await start([item(1, 'Litigation', { inUseCount: 12 })]);
    await menu(f, 'Litigation');
    all('[role=menuitem]')
      .find((m) => m.textContent!.includes('Deactivate'))!
      .click();
    await settle(f);
    expect(q('[data-deactivate-body]')!.textContent).toContain('12 matters keep this type.');
    all('.mf-dlg button')
      .find((b) => b.textContent!.trim() === 'Deactivate Matter Type')!
      .click();
    await settle(f);
    expect(api['updateMatterType']).toHaveBeenCalledWith(1, {
      name: 'Litigation',
      isActive: false,
      rowVersion: 'RV1',
    });
  });

  it('moves a row down with the menu and says so politely, with no toast', async () => {
    const f = await start([item(1, 'Litigation'), item(2, 'Advisory')]);
    await menu(f, 'Litigation');
    all('[role=menuitem]')
      .find((m) => m.textContent!.includes('Move Down'))!
      .click();
    await settle(f);
    expect(api['reorderMatterTypes']).toHaveBeenCalledWith({ ids: [2, 1] });
    expect(q('[data-announce]')!.textContent).toContain('Moved Litigation to position 2.');
  });

  it('refuses a duplicate name in the dialog, case ignored, saying when it is inactive', async () => {
    const f = await start([item(1, 'Litigation'), item(2, 'Advisory', { isActive: false })]);
    (q('[data-empty-new]') ?? null)?.click();
    // The page header owns New; the tab opens it through openNew().
    const tab = f.debugElement.children[0].componentInstance as MatterListTab;
    tab.openNew();
    await settle(f);
    const input = q('#matter-list-name') as HTMLInputElement;
    input.value = 'advisory';
    input.dispatchEvent(new Event('input'));
    all('.mf-dlg button')
      .find((b) => b.textContent!.trim() === 'Add Matter Type')!
      .click();
    await settle(f);
    expect(q('.mf-field__error')!.textContent).toContain(
      "A matter type named 'advisory' already exists. It is inactive; activate it instead.",
    );
    expect(api['createMatterType']).not.toHaveBeenCalled();
  });

  it('shows "No matter types yet." and the error block with Retry', async () => {
    await start([]);
    expect(q('[data-state-block]')!.textContent).toContain('No matter types yet.');
    TestBed.resetTestingModule();
    await start('error');
    expect(q('[data-state-block="error"]')!.textContent).toContain("Couldn't load matter types.");
  });
});
