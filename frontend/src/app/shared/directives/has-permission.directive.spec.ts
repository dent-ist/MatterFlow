import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeMeApi, profileOf, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermissionDirective } from './has-permission.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HasPermissionDirective],
  template: `
    <button id="single" *mfHasPermission="'Task.Assign'">Assign</button>
    <button id="any" *mfHasPermission="['Pod.Manage', 'Pod.ManageMembers']">Pods</button>
    <ng-template #denied><span id="denied">No access</span></ng-template>
    <button id="else" *mfHasPermission="'Audit.View'; else denied">Audit</button>
  `,
})
class Host {}

async function render(me: ConstructorParameters<typeof FakeMeApi>[0]) {
  const api = new FakeMeApi(me);
  TestBed.configureTestingModule({ providers: [provideFakeMe(api)] });
  await TestBed.inject(AuthStore).ensureLoaded();
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const q = (id: string) => (fixture.nativeElement as HTMLElement).querySelector(`#${id}`);
  return { api, fixture, q };
}

describe('mfHasPermission', () => {
  it('renders when the permission is held', async () => {
    const { q } = await render(withPermissions('Task.Assign'));
    expect(q('single')).not.toBeNull();
  });

  it('removes the element (hides, not disables) when the permission is missing', async () => {
    const { q } = await render(withPermissions('Task.View'));
    expect(q('single')).toBeNull();
  });

  it('accepts a list and renders when ANY is held', async () => {
    const { q } = await render(withPermissions('Pod.ManageMembers'));
    expect(q('any')).not.toBeNull();
  });

  it('supports an else template', async () => {
    const denied = await render(withPermissions('Task.View'));
    expect(denied.q('else')).toBeNull();
    expect(denied.q('denied')).not.toBeNull();
    TestBed.resetTestingModule();
    const allowed = await render(withPermissions('Audit.View'));
    expect(allowed.q('else')).not.toBeNull();
    expect(allowed.q('denied')).toBeNull();
  });

  it('shows everything to a system admin and nothing to a pending user', async () => {
    const admin = await render(profileOf({ isSystemAdmin: true }));
    expect(admin.q('single')).not.toBeNull();
    TestBed.resetTestingModule();
    const pending = await render(profileOf({ status: 'ACCESS_PENDING' }));
    expect(pending.q('single')).toBeNull();
  });

  it('reacts when permissions are refreshed', async () => {
    const { api, fixture, q } = await render(withPermissions('Task.View'));
    expect(q('single')).toBeNull();
    api.current = withPermissions('Task.View', 'Task.Assign');
    await TestBed.inject(AuthStore).refresh();
    await fixture.whenStable();
    expect(q('single')).not.toBeNull();
  });
});
