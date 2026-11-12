import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MatterTeamClient,
  MatterTeamMemberResponse,
  PeopleClient,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterTeamPanel } from './matter-team-panel';

const member = (
  id: number,
  name: string,
  over: Partial<MatterTeamMemberResponse> = {},
): MatterTeamMemberResponse => ({
  id,
  matterId: 7,
  personId: 100 + id,
  name,
  personType: 'INTERNAL',
  isSystemUser: false,
  personTitle: 'Partner',
  email: `${name.split(' ')[0].toLowerCase()}@firm.example`,
  companyName: undefined,
  title: { id: 1, name: 'Attorney', isActive: true },
  sortOrder: id,
  rowVersion: `RV${id}`,
  ...over,
});
const page = (items: MatterTeamMemberResponse[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});

@Component({
  imports: [MatterTeamPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-team-panel
    [matterId]="7"
    matterRef="00343-00012"
    matterName="Acme v. Beta"
    [canEdit]="canEdit()"
  />`,
})
class Host {
  readonly canEdit = signal(true);
}

describe('MatterTeamPanel (epic #1373, #1376)', () => {
  let team: { listMatterTeam: ReturnType<typeof vi.fn> };
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));

  async function start(rows: MatterTeamMemberResponse[] | 'error', canEdit = true) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    team = {
      listMatterTeam: vi
        .fn()
        .mockReturnValue(rows === 'error' ? apiError(500, { code: 'INTERNAL' }) : ok(page(rows))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Matter.Edit'))),
        { provide: MatterTeamClient, useValue: team },
        {
          provide: TeamTitlesClient,
          useValue: { listTeamTitles: vi.fn().mockReturnValue(ok([])) },
        },
        { provide: PeopleClient, useValue: { lookupPeople: vi.fn().mockReturnValue(ok([])) } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.canEdit.set(canEdit);
    await settle(fixture);
    await settle(fixture);
    return fixture;
  }

  it('reads the first page of the team by name and shows each person: initials, name, the title on this matter and the System User / Internal / External chip', async () => {
    await start([
      member(1, 'Maria Alvarez', {
        isSystemUser: true,
        title: { id: 2, name: 'Case Manager', isActive: true },
      }),
      member(2, 'Victor Lang', { personType: 'EXTERNAL', companyName: 'Hartman & Pike LLP' }),
    ]);
    expect(team.listMatterTeam).toHaveBeenCalledWith(7, 1, 100, 'name');
    expect(q('[data-panel-title]')!.textContent).toBe('Team');
    expect(q('[data-panel-count]')!.textContent!.trim()).toBe('2');
    const rows = all('[data-team-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('MA');
    expect(rows[0].querySelector('[data-member-name]')!.textContent).toBe('Maria Alvarez');
    expect(rows[0].querySelector('[data-member-title]')!.textContent).toBe('Case Manager');
    expect(rows[0].querySelector('[data-person-kind]')!.getAttribute('data-person-kind')).toBe(
      'system',
    );
    expect(rows[1].querySelector('[data-person-kind]')!.getAttribute('data-person-kind')).toBe(
      'external',
    );
    expect(q('[data-team-show-all]')).toBeNull(); // two rows fit the cap
  });

  it('shows three rows and "Show All N" for a longer team; Show All opens a read-only dialog with the whole team and one Close button', async () => {
    const fixture = await start([1, 2, 3, 4, 5].map((i) => member(i, `Person ${i}`)));
    expect(all('[data-team-row]')).toHaveLength(3);
    const showAll = q('[data-team-show-all]')!;
    expect(showAll.textContent!.trim()).toBe('Show All 5');
    showAll.click();
    await settle(fixture);
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Team (5)');
    expect(all('[data-team-all-row]')).toHaveLength(5);
    expect(q('[data-panel-primary]')).toBeNull();
    expect(all('.mf-formdlg button').some((b) => b.textContent!.trim() === 'Close')).toBe(true);
  });

  it('folds to the header (the count stays) and unfolds', async () => {
    const fixture = await start([member(1, 'Ann Lee')]);
    const toggle = q('[data-panel-toggle]') as HTMLButtonElement;
    toggle.click();
    await settle(fixture);
    expect(all('[data-team-row]')).toHaveLength(0);
    expect(q('[data-panel-count]')!.textContent!.trim()).toBe('1');
    toggle.click();
    await settle(fixture);
    expect(all('[data-team-row]')).toHaveLength(1);
  });

  it('an empty team is one line with "+ Add Member" for a person who may edit, and the same line without a button for a reader', async () => {
    await start([]);
    expect(q('[data-panel-empty]')!.textContent).toBe('No members');
    expect(q('[data-panel-toggle]')).toBeNull();
    expect(q('[data-team-add]')!.textContent).toContain('Add Member');

    TestBed.resetTestingModule();
    document.body.replaceChildren();
    await start([], false);
    expect(q('[data-panel-empty]')).not.toBeNull();
    expect(q('[data-team-add]')).toBeNull();
    expect(q('[data-team-edit]')).toBeNull();
  });

  it('Edit (named "Edit Team") is there only with Matter.Edit and opens the Edit Team dialog', async () => {
    const fixture = await start([member(1, 'Ann Lee')]);
    const edit = q('[data-team-edit]') as HTMLButtonElement;
    expect(edit.getAttribute('aria-label')).toBe('Edit Team');
    edit.click();
    await settle(fixture);
    expect(q('.mf-formdlg [data-panel-title]')!.textContent).toContain('Edit Team');

    TestBed.resetTestingModule();
    document.body.replaceChildren();
    await start([member(1, 'Ann Lee')], false);
    expect(q('[data-team-edit]')).toBeNull();
    expect(all('[data-team-row]')).toHaveLength(1);
  });

  it('a failed read is one error block with Retry that asks again', async () => {
    const fixture = await start('error');
    expect(q('[data-team-error]')!.textContent).toContain("Couldn't load the team.");
    team.listMatterTeam.mockReturnValue(ok(page([member(1, 'Ann Lee')])));
    (q('[data-team-error] button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(all('[data-team-row]')).toHaveLength(1);
    expect(q('[data-team-error]')).toBeNull();
  });
});
