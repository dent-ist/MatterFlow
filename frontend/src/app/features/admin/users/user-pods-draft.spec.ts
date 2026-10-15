import { UserPodDto } from '../../../core/identity-admin/identity-admin-api';
import {
  PodRow,
  choosePrimary,
  initialDraft,
  needsPrimary,
  podRows,
  podsText,
  sameDraft,
  togglePod,
} from './user-pods-draft';

const pod = (podId: number, name: string, isPrimary = false, isActive = true): UserPodDto => ({
  podId,
  name,
  isPrimary,
  isActive,
});

const rows: PodRow[] = [
  { podId: 1, name: 'Processing', isActive: true },
  { podId: 2, name: 'Review', isActive: true },
  { podId: 3, name: 'Legacy', isActive: false },
];

describe('Pods draft of the Users grid editor', () => {
  it('starts from the pods of the person', () => {
    expect(initialDraft([pod(1, 'Processing', true), pod(2, 'Review')])).toEqual({
      selected: [1, 2],
      primary: 1,
    });
    expect(initialDraft([])).toEqual({ selected: [], primary: null });
  });

  it('makes the first pod of a person with no pods the primary one', () => {
    const one = togglePod(initialDraft([]), 2, true, true);
    expect(one).toEqual({ selected: [2], primary: 2 });
    // The second pod does not take the primary over.
    expect(togglePod(one, 1, true, true)).toEqual({ selected: [2, 1], primary: 2 });
  });

  it('does not make an inactive pod the primary one', () => {
    expect(togglePod(initialDraft([]), 3, true, false)).toEqual({ selected: [3], primary: null });
  });

  it('clears the primary when the primary pod is unticked and never promotes another one', () => {
    const draft = initialDraft([pod(1, 'Processing', true), pod(2, 'Review')]);
    const after = togglePod(draft, 1, false, true);
    expect(after).toEqual({ selected: [2], primary: null });
    expect(needsPrimary(after, rows)).toBe(true);
    // Choosing it unblocks.
    expect(needsPrimary(choosePrimary(after, 2), rows)).toBe(false);
  });

  it('does not need a primary when no pod is left, or when only inactive pods are left', () => {
    const draft = initialDraft([pod(1, 'Processing', true)]);
    expect(needsPrimary(togglePod(draft, 1, false, true), rows)).toBe(false);
    expect(needsPrimary({ selected: [3], primary: null }, rows)).toBe(false);
  });

  it('keeps the primary when another pod is unticked, and ignores a primary that is not ticked', () => {
    const draft = initialDraft([pod(1, 'Processing', true), pod(2, 'Review')]);
    expect(togglePod(draft, 2, false, true).primary).toBe(1);
    expect(choosePrimary(draft, 9)).toBe(draft);
  });

  it('compares drafts regardless of order', () => {
    expect(sameDraft({ selected: [1, 2], primary: 1 }, { selected: [2, 1], primary: 1 })).toBe(
      true,
    );
    expect(sameDraft({ selected: [1, 2], primary: 1 }, { selected: [1, 2], primary: 2 })).toBe(
      false,
    );
    expect(sameDraft({ selected: [1], primary: 1 }, { selected: [1, 2], primary: 1 })).toBe(false);
  });

  it('reads the pods as text and lists active pods plus the pods the person is in, by name', () => {
    expect(
      podsText([pod(1, 'Processing', true), pod(2, 'Review'), pod(3, 'Old', false, false)]),
    ).toBe('Processing (primary), Review, Old (inactive)');
    expect(
      podRows(
        [
          { podId: 2, name: 'Review', isActive: true },
          { podId: 1, name: 'Processing', isActive: true },
        ],
        [pod(3, 'Legacy', false, false)],
      ).map((r) => r.name),
    ).toEqual(['Legacy', 'Processing', 'Review']);
  });
});
