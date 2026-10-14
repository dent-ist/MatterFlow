import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UsersLookupClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { ok, settle } from '../../../shared/testing/org-testing';
import { UserPicker } from './user-picker';

describe('UserPicker stored values (UAT2-01)', () => {
  let fixture: ComponentFixture<UserPicker>;
  let lookup: ReturnType<typeof vi.fn>;

  async function create(permissions: Permission[], inputs: Record<string, unknown>) {
    lookup = vi.fn().mockReturnValue(ok([{ userId: 7, displayName: 'Jamal Okafor' }]));
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: UsersLookupClient, useValue: { lookupUsers: lookup } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(UserPicker);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle(fixture);
    await settle(fixture);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows the display name of a stored user id, not "User 7"', async () => {
    await create(['Task.Assign'], { value: 7, readOnly: true });
    expect(fixture.nativeElement.querySelector('[data-readonly]').textContent).toContain(
      'Jamal Okafor',
    );
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('falls back to the id and makes no request without Task.Assign', async () => {
    await create(['Task.View'], { value: 7, readOnly: true });
    expect(fixture.nativeElement.querySelector('[data-readonly]').textContent).toContain('User 7');
    expect(lookup).not.toHaveBeenCalled();
  });
});
