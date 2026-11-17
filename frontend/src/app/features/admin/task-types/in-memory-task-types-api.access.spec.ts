import { firstValueFrom } from 'rxjs';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';

/** The stub's access rules behave like the server's (#1399): the lists are a set, Edit and Assign roles join View, a stale row version and an inactive new role are refused. */
describe('InMemoryTaskTypesApi access (#1402)', () => {
  let api: InMemoryTaskTypesApi;
  const rowVersion = async (): Promise<string> => (await firstValueFrom(api.get(1))).rowVersion;
  beforeEach(() => (api = new InMemoryTaskTypesApi()));

  it('starts open, carries the access object on the type and says it is not enforced', async () => {
    expect((await firstValueFrom(api.get(1))).access).toEqual({
      isRestricted: false,
      canView: [],
      canEdit: [],
      canAssign: [],
    });
    const view = await firstValueFrom(api.getAccess(1));
    expect(view.enforced).toBe(false);
    expect(view.roles.map((r) => r.name)).toContain('Vendor Liaison');
  });

  it('adds Edit and Assign roles to View, restricts the type and moves the row version', async () => {
    const before = await rowVersion();
    const saved = await firstValueFrom(
      api.replaceAccess(1, { canView: [], canEdit: [4], canAssign: [2], rowVersion: before }),
    );
    expect(saved).toMatchObject({
      isRestricted: true,
      canView: [2, 4],
      canEdit: [4],
      canAssign: [2],
    });
    expect(saved.rowVersion).not.toBe(before);
    expect((await firstValueFrom(api.get(1))).access?.isRestricted).toBe(true);
  });

  it('refuses a stale row version and a role that is inactive or unknown', async () => {
    await expect(
      firstValueFrom(
        api.replaceAccess(1, { canView: [1], canEdit: [], canAssign: [], rowVersion: 'old' }),
      ),
    ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });
    await expect(
      firstValueFrom(
        api.replaceAccess(1, {
          canView: [6],
          canEdit: [],
          canAssign: [],
          rowVersion: await rowVersion(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      firstValueFrom(
        api.replaceAccess(1, {
          canView: [99],
          canEdit: [],
          canAssign: [],
          rowVersion: await rowVersion(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('previews who loses view, whether the type opens up and whether the caller loses it, without changing anything', async () => {
    await firstValueFrom(
      api.replaceAccess(1, {
        canView: [1, 4],
        canEdit: [],
        canAssign: [],
        rowVersion: await rowVersion(),
      }),
    );
    const lose = await firstValueFrom(
      api.previewAccess(1, { canView: [4], canEdit: [], canAssign: [] }),
    );
    expect(lose).toMatchObject({
      peopleLosingView: 20,
      callerLosesView: true,
      becomesOpenToEveryone: false,
    });
    const open = await firstValueFrom(
      api.previewAccess(1, { canView: [], canEdit: [], canAssign: [] }),
    );
    expect(open).toMatchObject({
      becomesOpenToEveryone: true,
      callerLosesView: false,
      peopleLosingView: 0,
    });
    expect((await firstValueFrom(api.getAccess(1))).canView).toEqual([1, 4]);
  });
});
