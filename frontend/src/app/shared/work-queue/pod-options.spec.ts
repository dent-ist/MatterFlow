import { of } from 'rxjs';
import { PodsClient } from '../../api/generated/api-client';
import { loadPodChoices } from './pod-options';

describe('loadPodChoices', () => {
  it('does not call the Pods API for a user without Pod.View (UAT2-19)', async () => {
    const api = { listMyPods: vi.fn(), listPods: vi.fn() };

    const choices = await loadPodChoices(api as unknown as PodsClient, false);

    expect(choices).toEqual({ options: [], primaryPodId: null });
    expect(api.listMyPods).not.toHaveBeenCalled();
    expect(api.listPods).not.toHaveBeenCalled();
  });

  it('offers the own Pods and every active Pod with Pod.View', async () => {
    const api = {
      listMyPods: vi.fn().mockReturnValue(of([{ podId: 2, name: 'Zed', isPrimary: true }])),
      listPods: vi.fn().mockReturnValue(of({ items: [{ podId: 1, name: 'Alpha' }] })),
    };

    const choices = await loadPodChoices(api as unknown as PodsClient, true);

    expect(choices.options.map((o) => o.name)).toEqual(['Alpha', 'Zed']);
    expect(choices.primaryPodId).toBe(2);
  });
});
