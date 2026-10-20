import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { Permission } from '../../core/auth/permissions';
import { LabelsTab, labelsTabGuard } from './labels-tabs';

describe('labelsTabGuard (AD-D #523)', () => {
  async function run(tab: LabelsTab, ...permissions: Permission[]): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions(...permissions)))],
    });
    const result = await TestBed.runInInjectionContext(labelsTabGuard(tab));
    return result === true ? 'open' : TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('opens the tab the person may use', async () => {
    expect(await run('priorities', 'Priority.Manage')).toBe('open');
    expect(await run('status-labels', 'StatusLabel.Manage')).toBe('open');
    expect(await run('priorities', 'Priority.Manage', 'StatusLabel.Manage')).toBe('open');
    expect(await run('status-labels', 'Priority.Manage', 'StatusLabel.Manage')).toBe('open');
  });

  it('falls back to the first allowed tab instead of the 403 page', async () => {
    expect(await run('status-labels', 'Priority.Manage')).toBe('/admin/priorities');
    expect(await run('priorities', 'StatusLabel.Manage')).toBe('/admin/status-labels');
  });

  it('shows the 403 page to a person who may use neither tab', async () => {
    expect(await run('priorities', 'Task.View')).toBe('/403');
    expect(await run('status-labels', 'Audit.View')).toBe('/403');
  });
});
