import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';

/**
 * Pod Work fixtures (#547): signs in as each fixture person and asserts what the review states about them (pods, membership, permissions),
 * and that the busy pod has the numbers the other specs rely on. Calling the helper twice creates nothing new.
 */
test.describe('Pod Work fixtures (#547)', () => {
  test('the people and pods are what the review describes', async ({ seed, personas }) => {
    const fx = await podWorkFixtures(seed, personas);

    const me = async (user: string) => {
      const api = await Api.as(user);
      try {
        const profile = await api.get('/api/v1/me');
        const pods = await api.get('/api/v1/me/pods');
        return { can: new Set<string>(profile.permissions), pods };
      } finally {
        await api.dispose();
      }
    };
    const podIds = (pods: { podId?: number }[] | { items?: { podId: number }[] }) =>
      (Array.isArray(pods) ? pods : (pods.items ?? [])).map((p) => p.podId);

    const lead = await me(fx.lead.username);
    expect(
      lead.can.has('Pod.View') && lead.can.has('Task.View') && lead.can.has('Task.Assign'),
    ).toBe(true);
    expect(podIds(lead.pods)).toContain(fx.busy.podId);

    const readonly = await me(fx.readonly.username);
    expect(readonly.can.has('Pod.View') && readonly.can.has('Task.View')).toBe(true);
    expect(readonly.can.has('Task.Assign')).toBe(false);

    const podNoTask = await me(fx.podNoTask.username);
    expect(podNoTask.can.has('Pod.View') && podNoTask.can.has('Dashboard.View')).toBe(true);
    expect(podNoTask.can.has('Task.View')).toBe(false);

    for (const person of [fx.director, fx.observer, fx.noPod]) {
      expect(podIds((await me(person.username)).pods), person.username).toEqual([]);
    }
    expect((await me(fx.director.username)).can.has('Task.View')).toBe(true);

    const multi = await me(fx.multi.username);
    expect(new Set(podIds(multi.pods))).toEqual(new Set(fx.multi.pods.map((p) => p.podId)));
    const two = await me(fx.two.username);
    expect(podIds(two.pods)).toHaveLength(2);

    expect(fx.longName.name).toHaveLength(76);
    expect(fx.busy.members).toHaveLength(23);
    expect(await podWorkFixtures(seed, personas)).toBe(fx);
  });

  test('the busy pod has 4 unassigned, 20 assigned, 4 overdue and 6 on hold tasks', async ({
    seed,
    personas,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const api = await Api.as(fx.lead.username);
    try {
      const page = await api.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
      expect(page.pod.podId).toBe(fx.busy.podId);
      expect(page.summary).toMatchObject({
        unassignedToPerson: 4,
        assigned: 20,
        overdue: 4,
        onHold: 6,
      });
      expect(page.memberLoads).toHaveLength(23);
      const empty = await api.get(`/api/v1/pod-work?podId=${fx.empty.podId}&view=members`);
      expect(empty.memberLoads).toHaveLength(0);
    } finally {
      await api.dispose();
    }
  });
});
