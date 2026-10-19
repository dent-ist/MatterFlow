import { ComponentFixture, TestBed } from '@angular/core/testing';
import { settle } from '../../../shared/testing/org-testing';
import { PlacementRow, WorkflowStepRow, ruleBadge } from './workflow-step-row';

const row = (over: Partial<PlacementRow> = {}): PlacementRow => ({
  stepId: 7,
  title: 'Culling',
  isSkippable: false,
  skipCommentRequired: false,
  active: true,
  ...over,
});

describe('ruleBadge (VP2, #394)', () => {
  it('has one badge for the three rule combinations, icon and word', () => {
    expect(ruleBadge(row())).toEqual({ label: 'Required', tone: 'neutral', icon: 'pi-lock' });
    expect(ruleBadge(row({ isSkippable: true }))).toEqual({
      label: 'Skippable',
      tone: 'info',
      icon: 'pi-forward',
    });
    expect(ruleBadge(row({ isSkippable: true, skipCommentRequired: true }))).toEqual({
      label: 'Skippable - comment',
      tone: 'info',
      icon: 'pi-comment',
    });
  });
});

describe('mf-workflow-step-row (VP2, #394, #395)', () => {
  let fixture: ComponentFixture<WorkflowStepRow>;
  const el = (): HTMLElement => fixture.nativeElement;
  const set = (name: string, value: unknown) => fixture.componentRef.setInput(name, value);
  const menuIds = async (): Promise<string[]> => {
    el().querySelector<HTMLElement>('[data-overflow]')!.click();
    await settle(fixture);
    const ids = Array.from(el().querySelectorAll<HTMLElement>('[role=menuitem]')).map(
      (i) => i.dataset['action']!,
    );
    el().querySelector<HTMLElement>('[data-overflow]')!.click(); // closes it again
    await settle(fixture);
    return ids;
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(WorkflowStepRow);
    set('row', row());
    set('index', 1);
    set('editable', true);
    await settle(fixture);
  });

  it('shows the number, the title with its tooltip and the rule badge; the host carries the row markers', () => {
    expect(el().getAttribute('data-step-row')).toBe('Culling');
    expect(el().getAttribute('data-step-id')).toBe('7');
    expect(el().querySelector('.wsr__no')?.textContent).toBe('2');
    expect(el().querySelector('[data-step-title]')?.getAttribute('title')).toBe('Culling');
    expect(el().querySelector('[data-skip-summary]')?.textContent).toContain('Required');
  });

  it('an unordered version shows no number', async () => {
    set('ordered', false);
    await settle(fixture);
    expect(el().querySelector('.wsr__no')).toBeNull();
  });

  it('a draft row has the Skip rules badge and the overflow as its only controls', () => {
    const controls = Array.from(el().querySelectorAll('button, input'));
    expect(
      controls.map((c) => c.hasAttribute('data-rule') || c.hasAttribute('data-overflow')),
    ).toEqual([true, true]);
  });

  it('the menu offers Move up, Move down, Skip rules, Preview inputs and Remove; the ends lose a move', async () => {
    expect(await menuIds()).toEqual(['up', 'down', 'rules', 'preview', 'remove']);
    set('index', 0);
    await settle(fixture);
    expect(await menuIds()).toEqual(['down', 'rules', 'preview', 'remove']);
    set('index', 3);
    set('last', true);
    await settle(fixture);
    expect(await menuIds()).toEqual(['up', 'rules', 'preview', 'remove']);
  });

  it('says what was picked: move, remove and preview; the preview entry flips to Hide inputs', async () => {
    const moves: number[] = [];
    const events: string[] = [];
    fixture.componentInstance.move.subscribe((d) => moves.push(d));
    fixture.componentInstance.remove.subscribe(() => events.push('remove'));
    fixture.componentInstance.togglePreview.subscribe(() => events.push('preview'));
    for (const id of ['down', 'up', 'preview', 'remove']) {
      el().querySelector<HTMLElement>('[data-overflow]')!.click();
      await settle(fixture);
      el().querySelector<HTMLElement>(`[data-action="${id}"]`)!.click();
      await settle(fixture);
    }
    expect(moves).toEqual([1, -1]);
    expect(events).toEqual(['preview', 'remove']);
    set('previewOpen', true);
    await settle(fixture);
    el().querySelector<HTMLElement>('[data-overflow]')!.click();
    await settle(fixture);
    expect(el().querySelector('[data-action="preview"]')?.textContent).toContain('Hide inputs');
  });

  it('Skip rules opens a popover with the two checkboxes; Esc closes it and the badge keeps the focus', async () => {
    const skippable: boolean[] = [];
    fixture.componentInstance.skippable.subscribe((v) => skippable.push(v));
    const badge = el().querySelector<HTMLButtonElement>('[data-rule]')!;
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    badge.click();
    await settle(fixture);
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    const comment = el().querySelector<HTMLInputElement>('[data-comment="7"]')!;
    expect(comment.disabled).toBe(true);
    el().querySelector<HTMLInputElement>('[data-skippable="7"]')!.click();
    expect(skippable).toEqual([true]);
    set('row', row({ isSkippable: true }));
    await settle(fixture);
    expect(el().querySelector<HTMLInputElement>('[data-comment="7"]')!.disabled).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(el().querySelector('[data-rules-pop]')).toBeNull();
  });

  it('a read-only row shows the badge and a Preview inputs button, no overflow and no popover', async () => {
    set('editable', false);
    await settle(fixture);
    expect(el().querySelector('[data-overflow]')).toBeNull();
    expect(el().querySelector('[data-rule]')).toBeNull();
    const preview = el().querySelector<HTMLButtonElement>('[data-preview="7"]')!;
    expect(preview.getAttribute('aria-label')).toBe('Preview inputs of Culling');
    expect(preview.getAttribute('aria-expanded')).toBe('false');
  });

  it('a deactivated step is marked and says what to do', async () => {
    set('row', row({ active: false }));
    await settle(fixture);
    expect(el().querySelector('[data-inactive]')?.textContent).toContain('Deactivated');
    expect(el().textContent).toContain('This library step has been deactivated.');
  });
});
