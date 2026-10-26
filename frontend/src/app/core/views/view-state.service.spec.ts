import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { UserViewsClient } from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../auth/auth-testing';
import { AuthStore } from '../auth/auth.store';
import { ViewStateService } from './view-state.service';

describe('ViewStateService (#856)', () => {
  let api: {
    listMyViews: ReturnType<typeof vi.fn>;
    saveMyRememberedView: ReturnType<typeof vi.fn>;
    createMyView: ReturnType<typeof vi.fn>;
    updateMyView: ReturnType<typeof vi.fn>;
    deleteMyView: ReturnType<typeof vi.fn>;
  };
  let service: ViewStateService;

  const row = (state: object, name?: string) => ({
    id: 1,
    surface: 'my-matters.attention',
    name,
    isDefault: false,
    state,
    modifiedAtUtc: '2026-10-26T10:00:00Z',
    rowVersion: 'v1',
  });

  async function setup(): Promise<void> {
    localStorage.clear();
    api = {
      listMyViews: vi.fn().mockReturnValue(of({ items: [] })),
      saveMyRememberedView: vi.fn().mockReturnValue(of(row({}))),
      createMyView: vi.fn(),
      updateMyView: vi.fn(),
      deleteMyView: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions('Task.View'))),
        { provide: UserViewsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    service = TestBed.inject(ViewStateService);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has nothing cached at first and reads the server state, refreshing the cache', async () => {
    await setup();
    expect(service.cached('my-matters.attention')).toBeNull();
    api.listMyViews.mockReturnValue(of({ items: [row({ sort: 'type' })] }));
    expect(await service.load('my-matters.attention')).toEqual({ sort: 'type' });
    expect(api.listMyViews).toHaveBeenCalledWith('my-matters.attention');
    expect(service.cached('my-matters.attention')).toEqual({ sort: 'type' });
  });

  it('falls back to the cache when the endpoint fails, and to null when there is none', async () => {
    await setup();
    api.listMyViews.mockReturnValue(throwError(() => new Error('down')));
    expect(await service.load('task-queue')).toBeNull();
    service.save('task-queue', { sort: 'due' });
    expect(await service.load('task-queue')).toEqual({ sort: 'due' });
  });

  it('caches at once and sends the last state once after a short pause', async () => {
    await setup();
    service.save('my-matters.attention', { sort: 'due' });
    service.save('my-matters.attention', { sort: 'age', types: [1, 2] });
    expect(service.cached('my-matters.attention')).toEqual({ sort: 'age', types: [1, 2] });
    expect(api.saveMyRememberedView).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveMyRememberedView).toHaveBeenCalledTimes(1);
    expect(api.saveMyRememberedView).toHaveBeenCalledWith('my-matters.attention', {
      state: { sort: 'age', types: [1, 2] },
    });
  });

  it('never throws when the server rejects a write or storage is blocked', async () => {
    await setup();
    api.saveMyRememberedView.mockReturnValue(throwError(() => new Error('nope')));
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => service.save('assets', { a: 1 })).not.toThrow();
    await expect(service.flush('assets')).resolves.toBeUndefined();
    blocked.mockRestore();
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(service.cached('assets')).toBeNull();
    read.mockRestore();
  });

  it('drops a state over 4 KB instead of sending it', async () => {
    await setup();
    service.save('assets', { blob: 'x'.repeat(5000) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveMyRememberedView).not.toHaveBeenCalled();
    expect(service.cached('assets')).toBeNull();
  });

  it('keeps the cache per person', async () => {
    await setup();
    service.save('assets', { a: 1 });
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('mf.view.assets.'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^mf\.view\.assets\.\d+$/);
  });

  it('wraps the named view calls with the row version', async () => {
    await setup();
    const view = row({ a: 1 }, 'Intake focus');
    api.updateMyView.mockReturnValue(of({ ...view, name: 'Renamed' }));
    await service.update(view as never, { name: 'Renamed' });
    expect(api.updateMyView).toHaveBeenCalledWith(1, {
      name: 'Renamed',
      state: undefined,
      isDefault: undefined,
      rowVersion: 'v1',
    });
    api.deleteMyView.mockReturnValue(of(undefined));
    await service.remove(view as never);
    expect(api.deleteMyView).toHaveBeenCalledWith(1);
    api.listMyViews.mockReturnValue(of({ items: [row({}), view] }));
    expect((await service.listNamed('my-matters.attention')).map((v) => v.name)).toEqual([
      'Intake focus',
    ]);
  });
});
