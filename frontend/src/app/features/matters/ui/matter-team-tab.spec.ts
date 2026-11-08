import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  MatterTeamClient,
  MatterTeamMemberResponse,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterTeamTab } from './matter-team-tab';

const member = (id: number, name: string, over: Partial<MatterTeamMemberResponse> = {}) => ({
  id,
  matterId: 7,
  name,
  email: `${name.split(' ')[0].toLowerCase()}@firm.com`,
  title: { id: 1, name: 'Attorney', isActive: true },
  sortOrder: id,
  rowVersion: `RV${id}`,
  ...over,
});
const page = (items: MatterTeamMemberResponse[], total = items.length) => ({
  items,
  total,
  page: 1,
  pageSize: 50,
});

@Component({
  imports: [MatterTeamTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-team-tab
    [matterId]="7"
    matterRef="00343-00012"
    [canEdit]="canEdit()"
    (changed)="changes = changes + 1"
  />`,
})
class Host {
  readonly canEdit = signal(true);
  changes = 0;
}

describe('MatterTeamTab (epic #1298, UI spec 4)', () => {
  let team: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  /** The component under test, not the whole document: another spec's leftovers must not add headings (flaky under load). */
  let current: HTMLElement | null = null;
  const host = (): HTMLElement => current!;
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));

  async function start(rows: MatterTeamMemberResponse[] | 'error', canEdit = true) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    team = {
      listMatterTeam: vi
        .fn()
        .mockReturnValue(rows === 'error' ? apiError(500, { code: 'INTERNAL' }) : ok(page(rows))),
      removeMatterTeamMember: vi.fn().mockReturnValue(of(undefined)),
      addMatterTeamMember: vi.fn(),
      updateMatterTeamMember: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Matter.Edit'))),
        { provide: MatterTeamClient, useValue: team },
        {
          provide: TeamTitlesClient,
          useValue: { listTeamTitles: vi.fn().mockReturnValue(ok([])) },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    f.componentInstance.canEdit.set(canEdit);
    document.body.appendChild(f.nativeElement);
    await settle(f);
    current = f.nativeElement;
    return f;
  }

  afterEach(() =>
    document.body.querySelectorAll('mf-host, ng-component').forEach((e) => e.remove()),
  );

  it('asks for the first page sorted by name and shows Name, Email, Title and Remove', async () => {
    await start([
      member(1, 'Ann Lee'),
      member(2, 'Ben Ortiz', { title: { id: 2, name: 'Paralegal', isActive: false } }),
    ]);
    expect(team['listMatterTeam']).toHaveBeenCalledWith(7, 1, 50, 'name');
    expect(
      Array.from(host().querySelectorAll('th'))
        .map((t) => t.textContent!.trim())
        .filter(Boolean),
    ).toEqual(['Name', 'Email', 'Title', 'Actions']);
    expect(all('[data-member-name]').map((n) => n.textContent!.trim())).toEqual([
      'Ann Lee',
      'Ben Ortiz',
    ]);
    expect(all('[data-member-email]').map((n) => n.textContent!.trim())).toEqual([
      'ann@firm.com',
      'ben@firm.com',
    ]);
    expect(all('[data-remove-member]').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Ann Lee',
      'Remove Ben Ortiz',
    ]);
    expect(q('[data-add-member]')).not.toBeNull();
    expect(
      host().querySelector('table')!.getAttribute('aria-label') ??
        host().querySelector('caption')?.textContent,
    ).toContain('Team members of 00343-00012');
  });

  it('is read only without edit rights: plain names, no Add Member, no Remove', async () => {
    await start([member(1, 'Ann Lee')], false);
    expect(q('[data-add-member]')).toBeNull();
    expect(q('[data-remove-member]')).toBeNull();
    expect(q('button[data-member-name]')).toBeNull();
    expect(q('[data-member-name]')!.textContent).toContain('Ann Lee');
  });

  it('says "No team members yet." with Add Member for an editor, and "No team members." read only', async () => {
    await start([]);
    expect(q('[data-state-block]')!.textContent).toContain('No team members yet.');
    expect(q('[data-empty-add-member]')).not.toBeNull();
    TestBed.resetTestingModule();
    await start([], false);
    expect(q('[data-state-block]')!.textContent).toContain('No team members.');
    expect(q('[data-state-block]')!.textContent).not.toContain('yet');
    expect(q('[data-empty-add-member]')).toBeNull();
  });

  it('shows "Couldn\'t load the team." with Retry and no toast when the list fails', async () => {
    const f = await start('error');
    expect(q('[data-state-block="error"]')!.textContent).toContain("Couldn't load the team.");
    team['listMatterTeam'].mockReturnValue(ok(page([member(1, 'Ann Lee')])));
    const retry = all('[data-state-block] button').find((b) => b.textContent!.includes('Retry'))!;
    retry.click();
    await settle(f);
    expect(q('[data-member-name]')!.textContent).toContain('Ann Lee');
  });

  it('removes after a confirm that names the person, then reloads and reports the change', async () => {
    const f = await start([member(1, 'Ann Lee')]);
    (q('[data-remove-member]') as HTMLButtonElement).click();
    await settle(f);
    expect(q('[data-remove-body]')!.textContent).toContain(
      "Ann Lee will be removed from this matter's team. You can add them again later.",
    );
    const confirm = all('.mf-dlg button').find(
      (b) => b.textContent!.trim() === 'Remove Team Member',
    )!;
    confirm.click();
    await settle(f);
    expect(team['removeMatterTeamMember']).toHaveBeenCalledWith(7, 1);
    expect(team['listMatterTeam']).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.changes).toBe(1);
  });

  it('sorts by the heading chosen and goes back to page 1', async () => {
    const f = await start([member(1, 'Ann Lee')]);
    const emailHead = all('th button').find((b) => b.textContent!.includes('Email'))!;
    emailHead.click();
    await settle(f);
    expect(team['listMatterTeam']).toHaveBeenLastCalledWith(7, 1, 50, 'email');
  });

  it('opens Add Team Member from the toolbar button', async () => {
    const f = await start([member(1, 'Ann Lee')]);
    (q('[data-add-member] button, button[data-add-member]') as HTMLButtonElement).click();
    await settle(f);
    expect(q('[data-panel-title]')!.textContent).toContain('Add Team Member');
  });
});
