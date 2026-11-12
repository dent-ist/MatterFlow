import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  MatterListItemView,
  MatterTeamClient,
  MatterTeamMemberResponse,
  PeopleClient,
  PersonLookupItem,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterTeamDialog, TEAM_DIALOG_MESSAGES, titleItems } from './matter-team-dialog';

const title = (id: number, name: string, isActive = true, sortOrder = id): MatterListItemView => ({
  id,
  name,
  sortOrder,
  isActive,
  rowVersion: 'x',
  inUseCount: 0,
});

const member = (
  id: number,
  name: string,
  over: Partial<MatterTeamMemberResponse> = {},
): MatterTeamMemberResponse => ({
  id,
  matterId: 7,
  personId: 100 + id,
  name,
  personType: 'EXTERNAL',
  isSystemUser: false,
  personTitle: 'Partner',
  email: undefined,
  companyName: 'Hartman & Pike LLP',
  title: { id: 2, name: 'Paralegal', isActive: true },
  sortOrder: id,
  rowVersion: `RV${id}`,
  ...over,
});

const lookup = (personId: number, displayName: string): PersonLookupItem => ({
  personId,
  displayName,
  personType: 'INTERNAL',
  title: 'Associate',
  email: `${displayName.split(' ')[0].toLowerCase()}@firm.example`,
  companyName: undefined,
  userId: undefined,
  isSystemUser: false,
});

describe('titleItems', () => {
  it('offers the active titles in the administrator order, and keeps an inactive own title only while selected', () => {
    const list = [
      title(1, 'Attorney', true, 2),
      title(2, 'Paralegal', false, 1),
      title(3, 'Clerk', true, 1),
    ];
    expect(titleItems(list, null, '').map((i) => i.label)).toEqual(['Clerk', 'Attorney']);
    const own = { id: 2, name: 'Paralegal', isActive: false };
    expect(titleItems(list, own, '2').map((i) => i.label)).toEqual([
      'Paralegal (inactive)',
      'Clerk',
      'Attorney',
    ]);
    expect(titleItems(list, own, '3').map((i) => i.label)).toEqual(['Clerk', 'Attorney']);
  });
});

@Component({
  imports: [MatterTeamDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-matter-team-dialog
    matterRef="00343-00012"
    matterName="Acme v. Beta"
    [matterId]="7"
    [members]="members()"
    [(visible)]="open"
    (changed)="changes = changes + 1"
  />`,
})
class Host {
  readonly members = signal<MatterTeamMemberResponse[]>([]);
  readonly open = signal(true);
  changes = 0;
}

/** The dialog's own state, which a spec drives without a typed search (the person combobox has its own specs). */
interface Inner {
  add(p: PersonLookupItem): void;
  remove(key: number): void;
  setTitle(key: number, value: string): void;
  draftChanged(text: string): void;
  save(): Promise<void>;
  rows(): { key: number; personId: number; titleId: string; member: unknown }[];
  canSave(): boolean;
  summary(): string;
  pickError(): string | null;
}

describe('MatterTeamDialog (epic #1373, #1376)', () => {
  let team: Record<string, ReturnType<typeof vi.fn>>;
  let notify: { success: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));

  async function start(members: MatterTeamMemberResponse[]) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    team = {
      addMatterTeamMember: vi.fn().mockReturnValue(of(member(99, 'Added'))),
      updateMatterTeamMember: vi.fn().mockReturnValue(of(member(1, 'Changed'))),
      removeMatterTeamMember: vi.fn().mockReturnValue(of(undefined)),
    };
    notify = { success: vi.fn(), warn: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Matter.Edit'))),
        { provide: MatterTeamClient, useValue: team },
        {
          provide: TeamTitlesClient,
          useValue: {
            listTeamTitles: vi
              .fn()
              .mockReturnValue(ok([title(1, 'Attorney'), title(2, 'Paralegal')])),
          },
        },
        { provide: PeopleClient, useValue: { lookupPeople: vi.fn().mockReturnValue(ok([])) } },
        { provide: NotificationService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.members.set(members);
    await settle(fixture);
    await settle(fixture);
    const inner = fixture.debugElement.children[0].componentInstance as unknown as Inner;
    return { fixture, host: fixture.componentInstance, inner };
  }

  it('opens as a large Edit Team dialog with the saved people as rows, each with its title, and the empty picker row under them', async () => {
    await start([
      member(1, 'Ann Lee'),
      member(2, 'Ben Ortiz', { title: { id: 1, name: 'Attorney', isActive: true } }),
    ]);
    expect(q('.mf-formdlg')).not.toBeNull();
    expect(q('[data-panel-title]')!.textContent).toContain('Edit Team');
    expect(all('[data-team-rows] [data-team-row]')).toHaveLength(2);
    expect(all('[data-row-name]').map((e) => e.textContent!.trim())).toEqual([
      'Ann Lee',
      'Ben Ortiz',
    ]);
    expect(q('#team-add')).not.toBeNull();
    expect(q('[data-team-summary]')!.textContent).toContain('No changes yet.');
    expect(q('[data-panel-primary]')!.getAttribute('aria-disabled')).toBe('true');
    expect(q('[data-team-intro]')!.textContent).toBe(TEAM_DIALOG_MESSAGES.intro);
    expect(all('[data-remove-row]').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Ann Lee',
      'Remove Ben Ortiz',
    ]);
  });

  it('a picked person joins the list with no title; Save stays disabled until every row has a title; then it adds with the person and the title', async () => {
    const { fixture, host, inner } = await start([member(1, 'Ann Lee')]);
    inner.add(lookup(500, 'Grace Liu'));
    await settle(fixture);
    expect(all('[data-team-rows] [data-team-row]')).toHaveLength(2);
    expect(all('[data-team-row][data-added]')).toHaveLength(1);
    expect(inner.summary()).toBe(`1 added. ${TEAM_DIALOG_MESSAGES.needTitles}`);
    expect(inner.canSave()).toBe(false);

    const added = inner.rows().find((r) => !r.member)!;
    inner.setTitle(added.key, '1');
    await settle(fixture);
    expect(inner.summary()).toBe('1 added.');
    expect(inner.canSave()).toBe(true);
    await inner.save();
    expect(team['addMatterTeamMember']).toHaveBeenCalledWith(7, { personId: 500, teamTitleId: 1 });
    expect(team['removeMatterTeamMember']).not.toHaveBeenCalled();
    expect(team['updateMatterTeamMember']).not.toHaveBeenCalled();
    expect(host.changes).toBe(1);
    expect(host.open()).toBe(false);
    expect(notify.success).toHaveBeenCalledWith('Team saved', '1 added.');
  });

  it('a person who is already on the list is not added twice', async () => {
    const { inner } = await start([member(1, 'Ann Lee')]);
    inner.add(lookup(101, 'Ann Lee')); // the person of the saved row
    expect(inner.rows()).toHaveLength(1);
  });

  it('removes a saved row and changes a title on Save: removals first, then the title change with the row version', async () => {
    const { fixture, inner } = await start([member(1, 'Ann Lee'), member(2, 'Ben Ortiz')]);
    const [first, second] = inner.rows();
    inner.remove(first.key);
    inner.setTitle(second.key, '1');
    await settle(fixture);
    expect(inner.summary()).toBe('1 removed, 1 retitled.');
    await inner.save();
    expect(team['removeMatterTeamMember']).toHaveBeenCalledWith(7, 1);
    expect(team['updateMatterTeamMember']).toHaveBeenCalledWith(7, 2, {
      teamTitleId: 1,
      rowVersion: 'RV2',
    });
    const order = [
      team['removeMatterTeamMember'].mock.invocationCallOrder[0],
      team['updateMatterTeamMember'].mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('picking a person again after removing them puts the saved row back: nothing to add and nothing to remove', async () => {
    const { fixture, inner } = await start([member(1, 'Ann Lee')]);
    inner.remove(inner.rows()[0].key);
    expect(inner.summary()).toBe('1 removed.');
    inner.add(lookup(101, 'Ann Lee'));
    await settle(fixture);
    expect(inner.rows()).toHaveLength(1);
    expect(inner.rows()[0].member).not.toBeNull();
    expect(inner.summary()).toBe('No changes yet.');
    expect(inner.canSave()).toBe(false);
  });

  it('refuses to save while text is typed in the empty row and nothing is picked: "Choose a person from the list."', async () => {
    const { inner } = await start([member(1, 'Ann Lee')]);
    inner.remove(inner.rows()[0].key);
    inner.draftChanged('Somebody Not Picked');
    await inner.save();
    expect(inner.pickError()).toBe('Choose a person from the list.');
    expect(team['removeMatterTeamMember']).not.toHaveBeenCalled();
    inner.draftChanged('');
    expect(inner.pickError()).toBeNull();
  });

  it('when one of the calls fails the dialog closes, the panel reloads (changed) and a warning says the team is partly saved', async () => {
    const { fixture, host, inner } = await start([member(1, 'Ann Lee')]);
    team['addMatterTeamMember'].mockReturnValue(throwError(() => new Error('conflict')));
    inner.remove(inner.rows()[0].key);
    inner.add(lookup(500, 'Grace Liu'));
    inner.setTitle(inner.rows()[0].key, '2');
    await settle(fixture);
    await inner.save();
    expect(team['removeMatterTeamMember']).toHaveBeenCalledTimes(1);
    expect(host.changes).toBe(1);
    expect(host.open()).toBe(false);
    expect(notify.warn).toHaveBeenCalledWith(
      'Team partly saved',
      expect.stringContaining('not saved'),
    );
    expect(notify.success).not.toHaveBeenCalled();
  });
});
