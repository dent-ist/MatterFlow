import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  MatterListItemView,
  MatterTeamClient,
  MatterTeamMemberResponse,
  TeamTitlesClient,
  UsersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { TEAM_MESSAGES, TeamMemberDialog, emailProblem, titleItems } from './team-member-dialog';

const title = (id: number, name: string, isActive = true, sortOrder = id): MatterListItemView => ({
  id,
  name,
  sortOrder,
  isActive,
  rowVersion: 'x',
  inUseCount: 0,
});

const member = (over: Partial<MatterTeamMemberResponse> = {}): MatterTeamMemberResponse => ({
  id: 5,
  matterId: 7,
  name: 'Ann Lee',
  email: 'ann.lee@firm.com',
  title: { id: 2, name: 'Paralegal', isActive: true },
  sortOrder: 1,
  rowVersion: 'RV1',
  ...over,
});

describe('emailProblem and titleItems (UI spec 4.3)', () => {
  it('words the email problems exactly and ignores letter case for a duplicate', () => {
    expect(emailProblem('', [])).toBe('Enter an email address.');
    expect(emailProblem('   ', [])).toBe('Enter an email address.');
    for (const bad of ['ann', 'ann@', 'ann@firm', 'a nn@firm.com', 'ann@@firm.com', '@firm.com']) {
      expect(emailProblem(bad, []), bad).toBe('Enter a valid email address.');
    }
    expect(emailProblem(' Ann.Lee@Firm.com ', ['ann.lee@firm.com'])).toBe(
      'This email is already on the team.',
    );
    expect(emailProblem('ben@vendor.example', ['ann.lee@firm.com'])).toBeNull();
  });

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
  imports: [TeamMemberDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-team-member-dialog
    matterRef="00343-00012"
    [matterId]="7"
    [member]="member()"
    [takenEmails]="taken()"
    [(visible)]="open"
    (saved)="log.push($event.name)"
  />`,
})
class Host {
  readonly member = signal<MatterTeamMemberResponse | null>(null);
  readonly taken = signal<string[]>(['ben@vendor.example']);
  readonly open = signal(true);
  readonly log: string[] = [];
}

describe('TeamMemberDialog', () => {
  let team: Record<string, ReturnType<typeof vi.fn>>;
  let users: { listUsers: ReturnType<typeof vi.fn> };
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const type = (selector: string, value: string) => {
    const input = q(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function start(
    opts: { edit?: boolean; permissions?: Permission[]; titles?: MatterListItemView[] } = {},
  ) {
    document.body.querySelectorAll('.p-dialog-mask').forEach((e) => e.remove());
    team = {
      addMatterTeamMember: vi.fn().mockReturnValue(ok(member({ name: 'New Person' }))),
      updateMatterTeamMember: vi.fn().mockReturnValue(ok(member())),
    };
    users = {
      listUsers: vi.fn().mockReturnValue(
        ok({
          items: [
            { userId: 3, displayName: 'Cara Diaz', email: 'cara@firm.com' },
            { userId: 4, displayName: 'No Mail', email: undefined },
          ],
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(
          new FakeMeApi(withPermissions(...(opts.permissions ?? ['Matter.View', 'Matter.Edit']))),
        ),
        { provide: MatterTeamClient, useValue: team },
        { provide: UsersClient, useValue: users },
        {
          provide: TeamTitlesClient,
          useValue: {
            listTeamTitles: vi
              .fn()
              .mockReturnValue(of(opts.titles ?? [title(1, 'Attorney'), title(2, 'Paralegal')])),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(Host);
    if (opts.edit) f.componentInstance.member.set(member());
    await settle(f);
    return f;
  }

  async function pickTitle(f: Awaited<ReturnType<typeof start>>, label: string) {
    (q('#member-title') as HTMLButtonElement).click();
    await settle(f);
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role=option]')).find(
      (o) => o.textContent!.includes(label),
    )!;
    option.click();
    await settle(f);
  }

  it('opens as Add Team Member with the CM Number as subtitle and no Fill from a User without User.View', async () => {
    await start();
    expect(q('.p-dialog-title, [data-panel-title]')!.textContent).toContain('Add Team Member');
    expect(q('.mf-formdlg')!.textContent).toContain('00343-00012');
    expect(q('#member-pick')).toBeNull();
    expect((q('[data-panel-primary] button') as HTMLButtonElement).textContent).toContain(
      'Add Member',
    );
  });

  it('says what is missing with the exact messages and adds nothing', async () => {
    const f = await start();
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    const text = q('.mf-formdlg')!.textContent!;
    expect(text).toContain(TEAM_MESSAGES.name);
    expect(text).toContain(TEAM_MESSAGES.emailEmpty);
    expect(text).toContain(TEAM_MESSAGES.title);
    expect(team['addMatterTeamMember']).not.toHaveBeenCalled();
  });

  it('refuses an email that is already on the loaded rows, letter case ignored', async () => {
    const f = await start();
    type('#member-email', 'BEN@vendor.example');
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(q('#member-email-error')!.textContent).toContain('This email is already on the team.');
  });

  it('adds a trimmed member with the chosen title and tells the person', async () => {
    const f = await start();
    type('#member-name', '  New Person ');
    type('#member-email', ' new@firm.com ');
    await pickTitle(f, 'Paralegal');
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(team['addMatterTeamMember']).toHaveBeenCalledWith(7, {
      name: 'New Person',
      email: 'new@firm.com',
      teamTitleId: 2,
    });
    expect(f.componentInstance.log).toEqual(['New Person']);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('maps a 409 DUPLICATE_TEAM_EMAIL answer to the email field message', async () => {
    const f = await start();
    team['addMatterTeamMember'].mockReturnValue(
      apiError(409, {
        code: 'DUPLICATE_TEAM_EMAIL',
        errors: {
          email: [{ code: 'DUPLICATE_TEAM_EMAIL', message: 'x is already on this matter.' }],
        },
      }),
    );
    type('#member-name', 'Dup');
    type('#member-email', 'dup@firm.com');
    await pickTitle(f, 'Attorney');
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(q('#member-email-error')!.textContent).toContain('This email is already on the team.');
    expect(f.componentInstance.open()).toBe(true);
  });

  it('edits with the three values, the row version and the member title as the selected entry', async () => {
    const f = await start({ edit: true });
    expect(q('[data-panel-title], .p-dialog-title')!.textContent).toContain('Edit Team Member');
    expect((q('#member-name') as HTMLInputElement).value).toBe('Ann Lee');
    expect((q('#member-email') as HTMLInputElement).value).toBe('ann.lee@firm.com');
    expect(q('#member-title')!.textContent).toContain('Paralegal');
    type('#member-name', 'Ann B. Lee');
    (q('[data-panel-primary] button') as HTMLButtonElement).click();
    await settle(f);
    expect(team['updateMatterTeamMember']).toHaveBeenCalledWith(7, 5, {
      name: 'Ann B. Lee',
      email: 'ann.lee@firm.com',
      teamTitleId: 2,
      rowVersion: 'RV1',
    });
  });

  it('disables Title and Add Member with the help line when no title is active', async () => {
    const f = await start({ titles: [title(1, 'Attorney', false)] });
    expect(q('[data-no-titles]')!.textContent).toContain(
      'No team titles yet. An administrator adds them under Administration > Matter Lists.',
    );
    expect((q('#member-title') as HTMLButtonElement).disabled).toBe(true);
    expect(q('[data-panel-primary]')!.getAttribute('aria-disabled')).toBe('true');
    expect(f.componentInstance.open()).toBe(true);
  });

  it('fills Name and Email only from a chosen user, then clears the picker', async () => {
    const f = await start({ permissions: ['Matter.View', 'Matter.Edit', 'User.View'] });
    type('#member-pick', 'Cara');
    await new Promise((r) => setTimeout(r, 400));
    await settle(f);
    const option = q('[role=option]') as HTMLElement;
    expect(option.textContent).toContain('Cara Diaz');
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(f);
    expect((q('#member-name') as HTMLInputElement).value).toBe('Cara Diaz');
    expect((q('#member-email') as HTMLInputElement).value).toBe('cara@firm.com');
    expect(q('[data-pick-note]')!.textContent).toContain('Filled from Cara Diaz.');
    expect((q('#member-pick') as HTMLInputElement).value).toBe('');
    expect(q('#member-title')!.textContent).toContain('Choose a title');
  });
});
