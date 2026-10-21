import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PodChoice, UserPodDto } from '../../../core/identity-admin/identity-admin-api';
import { PodsChange, UserPodsCell } from './user-pods-cell';

const pod = (podId: number, name: string, isPrimary = false, isActive = true): UserPodDto => ({
  podId,
  name,
  isPrimary,
  isActive,
});

const CATALOG: PodChoice[] = [
  { podId: 1, name: 'Processing' },
  { podId: 2, name: 'Review' },
  { podId: 4, name: 'Intake' },
];

describe('UserPodsCell', () => {
  let fixture: ComponentFixture<UserPodsCell>;
  let applied: PodsChange[];
  let opened: number;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));

  async function create(
    pods: UserPodDto[],
    inputs: { canEdit?: boolean; catalog?: PodChoice[] | null; busy?: boolean } = {},
  ): Promise<void> {
    fixture = TestBed.createComponent(UserPodsCell);
    applied = [];
    opened = 0;
    fixture.componentRef.setInput('displayName', 'Jamal Okafor');
    fixture.componentRef.setInput('pods', pods);
    fixture.componentRef.setInput('canEdit', inputs.canEdit ?? true);
    fixture.componentRef.setInput(
      'catalog',
      inputs.catalog === undefined ? CATALOG : inputs.catalog,
    );
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    fixture.componentInstance.applied.subscribe((c) => applied.push(c));
    fixture.componentInstance.opened.subscribe(() => opened++);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
  }

  async function openPopover(): Promise<void> {
    q('[data-pods-trigger]').click();
    await settle();
  }

  const tick = async (podId: number): Promise<void> => {
    q(`[data-pod-option="${podId}"]`).click();
    await settle();
  };

  const apply = (): HTMLElement => q('[data-pods-apply]');
  const isBlocked = (): boolean => apply().getAttribute('aria-disabled') === 'true';

  describe('chips', () => {
    it('shows the primary pod with a star and the text Primary, and the others plain', async () => {
      await create([pod(1, 'Processing', true), pod(2, 'Review')], { canEdit: false });
      const chips = all('[data-pod-chip]');
      expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'Processing Primary',
        'Review',
      ]);
      expect(chips[0].querySelector('.pi-star-fill')).not.toBeNull();
      expect(chips[1].hasAttribute('data-primary')).toBe(false);
      expect(q('[data-pod-count]').textContent).toContain('2 pods');
    });

    it('one line: the primary pod and "+n", every pod stays in the tooltip and in the button name', async () => {
      await create([pod(1, 'Processing'), pod(2, 'Review', true), pod(3, 'Intake')], {
        canEdit: true,
      });
      fixture.componentRef.setInput('oneLine', true);
      await settle();
      const chips = all('[data-pod-chip]');
      expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'Review Primary',
      ]);
      expect(q('[data-pod-more]').textContent).toContain('+2');
      expect(q('[data-pod-more]').getAttribute('title')).toBe('Processing, Intake');
      expect(el().classList).toContain('upc--one');
      expect(q('[data-pods-trigger]').getAttribute('aria-label')).toContain('Processing');
      expect(q('[data-pods-trigger]').getAttribute('aria-label')).toContain('Intake');
    });

    it('says No pod when the person has none', async () => {
      await create([], { canEdit: false });
      expect(q('[data-no-pod]').textContent).toContain('No pod');
      expect(all('[data-pod-chip]').length).toBe(0);
    });

    it('mutes an inactive pod and collapses more than three pods into +N', async () => {
      await create(
        [pod(1, 'A', true), pod(2, 'B'), pod(3, 'C', false, false), pod(4, 'D'), pod(5, 'E')],
        { canEdit: false },
      );
      expect(all('[data-pod-chip]').length).toBe(3);
      expect(all('.upc-chip--inactive').length).toBe(1);
      expect(q('[data-pod-more]').textContent).toContain('+2');
      expect(q('[data-pod-more]').getAttribute('title')).toBe('D, E');
    });

    it('is read-only without edit rights: chips only, no button', async () => {
      await create([pod(1, 'Processing', true)], { canEdit: false });
      expect(el().querySelector('[data-pods-trigger]')).toBeNull();
      expect(q('[data-pods-readonly]').textContent).toContain('Processing');
    });
  });

  describe('accessible names', () => {
    it('names the button with the visible pods and what it does', async () => {
      await create([pod(1, 'Processing', true), pod(2, 'Review')]);
      expect(q('[data-pods-trigger]').getAttribute('aria-label')).toBe(
        'Pods: Processing (primary), Review, change pods of Jamal Okafor',
      );
    });

    it('names an empty cell and an inactive pod', async () => {
      await create([]);
      expect(q('[data-pods-trigger]').getAttribute('aria-label')).toBe(
        'Pods: none, change pods of Jamal Okafor',
      );
      await create([pod(3, 'Legacy', false, false)]);
      expect(q('[data-pods-trigger]').getAttribute('aria-label')).toContain('Legacy (inactive)');
    });

    it('names the popover, the search box, the checkboxes and the Primary radios', async () => {
      await create([pod(1, 'Processing', true)]);
      await openPopover();
      expect(q('[role="dialog"]').getAttribute('aria-label')).toBe('Change pods of Jamal Okafor');
      expect(q('[data-pods-search]').getAttribute('aria-label')).toBe('Search pods');
      expect(q('[data-pod-primary="1"]').getAttribute('aria-label')).toBe(
        'Primary pod: Processing',
      );
      expect(q('[data-pod-option="2"]').closest('label')!.textContent).toContain('Review');
    });
  });

  describe('popover', () => {
    it('opens on click, asks the page for the pods, and lists the active pods with the ticked ones checked', async () => {
      await create([pod(1, 'Processing', true)]);
      await openPopover();
      expect(opened).toBe(1);
      expect(q('[data-pods-trigger]').getAttribute('aria-expanded')).toBe('true');
      expect(all('[data-pod-option]').map((c) => c.getAttribute('data-pod-option'))).toEqual([
        '4',
        '1',
        '2',
      ]);
      expect((q('[data-pod-option="1"]') as HTMLInputElement).checked).toBe(true);
      expect((q('[data-pod-primary="1"]') as HTMLInputElement).checked).toBe(true);
      // Primary radios only on ticked pods.
      expect(all('[data-pod-primary]').length).toBe(1);
      expect(isBlocked()).toBe(true); // nothing changed yet
    });

    it('opens with Arrow Down on the button and focuses the search box', async () => {
      await create([]);
      q('[data-pods-trigger]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      await settle();
      expect(q('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement).toBe(q('[data-pods-search]'));
    });

    it('makes the first pod added the primary one, and applies one change', async () => {
      await create([]);
      await openPopover();
      await tick(2);
      expect((q('[data-pod-primary="2"]') as HTMLInputElement).checked).toBe(true);
      await tick(4);
      expect((q('[data-pod-primary="2"]') as HTMLInputElement).checked).toBe(true);
      expect((q('[data-pod-primary="4"]') as HTMLInputElement).checked).toBe(false);
      expect(applied).toEqual([]); // nothing is sent per click
      apply().click();
      await settle();
      expect(applied).toEqual([{ podIds: [2, 4], primaryPodId: 2 }]);
      expect(el().querySelector('[role="dialog"]')).toBeNull();
    });

    it('lets the primary radio move the primary pod', async () => {
      await create([pod(1, 'Processing', true), pod(2, 'Review')]);
      await openPopover();
      q('[data-pod-primary="2"]').click();
      await settle();
      apply().click();
      await settle();
      expect(applied).toEqual([{ podIds: [1, 2], primaryPodId: 2 }]);
    });

    it('asks for the new primary when the primary pod is removed, and blocks Apply until one is chosen', async () => {
      await create([pod(1, 'Processing', true), pod(2, 'Review')]);
      await openPopover();
      await tick(1); // untick the primary pod
      expect(q('[data-primary-required]').textContent).toContain('Choose the primary pod');
      expect((q('[data-pod-primary="2"]') as HTMLInputElement).checked).toBe(false); // not promoted silently
      expect(isBlocked()).toBe(true);
      expect(apply().getAttribute('aria-describedby')).toBe(q('[data-primary-required]').id);

      apply().click(); // blocked: nothing happens
      await settle();
      expect(applied).toEqual([]);
      expect(q('[role="dialog"]')).not.toBeNull();

      q('[data-pod-primary="2"]').click();
      await settle();
      expect(el().querySelector('[data-primary-required]')).toBeNull();
      expect(isBlocked()).toBe(false);
      apply().click();
      await settle();
      expect(applied).toEqual([{ podIds: [2], primaryPodId: 2 }]);
    });

    it('applies removing every pod without a primary', async () => {
      await create([pod(1, 'Processing', true)]);
      await openPopover();
      await tick(1);
      expect(el().querySelector('[data-primary-required]')).toBeNull();
      apply().click();
      await settle();
      expect(applied).toEqual([{ podIds: [], primaryPodId: undefined }]);
    });

    it('keeps an inactive pod the person is in (muted, removable) and does not offer the others', async () => {
      await create([pod(1, 'Processing', true), pod(9, 'Legacy', false, false)]);
      await openPopover();
      const legacy = q('[data-pod-option="9"]').closest('li')!;
      expect(legacy.classList.contains('upc-row--muted')).toBe(true);
      expect(legacy.textContent).toContain('inactive');
      expect(q('[data-pods-inactive-note]')).not.toBeNull();
      // Its Primary radio cannot be chosen.
      expect((q('[data-pod-primary="9"]') as HTMLInputElement).disabled).toBe(true);
      await tick(9); // remove it
      apply().click();
      await settle();
      expect(applied).toEqual([{ podIds: [1], primaryPodId: 1 }]);
    });

    it('filters the checklist with the search box', async () => {
      await create([]);
      await openPopover();
      const search = q<HTMLInputElement>('[data-pods-search]');
      search.value = 'rev';
      search.dispatchEvent(new Event('input'));
      await settle();
      expect(all('[data-pod-option]').map((c) => c.getAttribute('data-pod-option'))).toEqual(['2']);
      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      await settle();
      expect(q('[data-pods-empty]').textContent).toContain('No pods match');
    });

    it('shows Loading until the pods arrive and an error when they cannot be loaded', async () => {
      await create([], { catalog: null });
      await openPopover();
      expect(q('[role="dialog"]').textContent).toContain('Loading');
      fixture.componentRef.setInput('catalogFailed', true);
      await settle();
      expect(q('[data-pods-failed]').textContent).toContain('could not be loaded');
    });

    it('does not open while a save runs', async () => {
      await create([pod(1, 'Processing', true)], { busy: true });
      await openPopover();
      expect(el().querySelector('[role="dialog"]')).toBeNull();
      expect(q('[data-pods-trigger]').getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('keyboard', () => {
    it('closes with Escape without applying and returns focus to the button', async () => {
      await create([pod(1, 'Processing', true)]);
      await openPopover();
      await tick(2);
      q('[role="dialog"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();
      expect(el().querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(q('[data-pods-trigger]'));
      expect(applied).toEqual([]);
    });

    it('moves through the search box and the checklist with the arrow keys', async () => {
      await create([]);
      document.body.appendChild(fixture.nativeElement);
      await openPopover();
      const search = q('[data-pods-search]');
      search.focus();
      const press = async (key: string): Promise<void> => {
        (document.activeElement as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true }),
        );
        await settle();
      };
      await press('ArrowDown');
      expect(document.activeElement).toBe(q('[data-pod-option="4"]'));
      await press('ArrowDown');
      expect(document.activeElement).toBe(q('[data-pod-option="1"]'));
      await press('ArrowUp');
      await press('ArrowUp');
      expect(document.activeElement).toBe(search);
      await press('ArrowUp'); // wraps to the last
      expect(document.activeElement).toBe(q('[data-pod-option="2"]'));
      fixture.nativeElement.remove();
    });

    it('Cancel closes without applying and returns focus', async () => {
      await create([]);
      await openPopover();
      await tick(2);
      q('[data-pods-cancel]').click();
      await settle();
      expect(applied).toEqual([]);
      expect(document.activeElement).toBe(q('[data-pods-trigger]'));
    });
  });
});
