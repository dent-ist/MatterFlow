import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { settle } from '../../../shared/testing/org-testing';
import { WorkflowVersionBar } from './workflow-version-bar';

describe('mf-workflow-version-bar (VP1, #357)', () => {
  let fixture: ComponentFixture<WorkflowVersionBar>;
  const el = (): HTMLElement => fixture.nativeElement;
  const labels = (): string[] =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-action-bar] button, [data-action-bar] a'))
      .map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim())
      .filter((t) => t !== '');
  const set = (name: string, value: unknown) => fixture.componentRef.setInput(name, value);
  const press = (label: string) =>
    Array.from(el().querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === label)!
      .click();

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(WorkflowVersionBar);
    set('workflowId', '1');
    set('versionNo', 3);
    await settle(fixture);
  });

  it('draft: Save draft, Publish... and the overflow in this order; the primary action is the last button before the overflow', async () => {
    set('editable', true);
    set('canPublish', true);
    await settle(fixture);
    expect(labels()).toEqual(['Save draft', 'Publish...', 'More version actions']);
    expect(el().querySelector('[data-dirty]')).toBeNull();
  });

  it('draft: Save draft needs changes, Publish needs a step, both are off while busy, and Unsaved changes shows when dirty', async () => {
    set('editable', true);
    set('canPublish', false);
    await settle(fixture);
    const btn = (l: string) =>
      Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === l)!;
    expect(btn('Save draft').disabled).toBe(true);
    expect(btn('Publish...').disabled).toBe(true);
    set('canPublish', true);
    set('dirty', true);
    await settle(fixture);
    expect(btn('Save draft').disabled).toBe(false);
    expect(btn('Publish...').disabled).toBe(false);
    expect(el().querySelector('[data-dirty]')?.textContent).toContain('Unsaved changes');
    set('busy', true);
    await settle(fixture);
    expect(btn('Save draft').disabled).toBe(true);
    expect(btn('Publish...').disabled).toBe(true);
  });

  it('draft: the buttons say what was pressed and Discard draft is in the overflow', async () => {
    set('editable', true);
    set('dirty', true);
    await settle(fixture);
    const saved = vi.fn();
    const published = vi.fn();
    const discarded = vi.fn();
    fixture.componentInstance.save.subscribe(saved);
    fixture.componentInstance.publish.subscribe(published);
    fixture.componentInstance.discard.subscribe(discarded);
    press('Save draft');
    press('Publish...');
    expect(saved).toHaveBeenCalledTimes(1);
    expect(published).toHaveBeenCalledTimes(1);
    expect(el().textContent).not.toContain('Discard draft');
    el().querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(fixture);
    el().querySelector<HTMLButtonElement>('[data-action="discard"]')!.click();
    expect(discarded).toHaveBeenCalledTimes(1);
  });

  it('read-only without a draft: Create new draft, and Retire version in the overflow only for a published version', async () => {
    await settle(fixture);
    expect(labels()).toEqual(['Create new draft from v3']);
    set('published', true);
    await settle(fixture);
    expect(labels()).toEqual(['Create new draft from v3', 'More version actions']);
    const created = vi.fn();
    const retired = vi.fn();
    fixture.componentInstance.newDraft.subscribe(created);
    fixture.componentInstance.retire.subscribe(retired);
    press('Create new draft from v3');
    expect(created).toHaveBeenCalledTimes(1);
    el().querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await settle(fixture);
    el().querySelector<HTMLButtonElement>('[data-action="retire"]')!.click();
    expect(retired).toHaveBeenCalledTimes(1);
  });

  it('read-only with a draft: Open draft is a link to it and replaces the disabled button', async () => {
    set('published', true);
    set('draftVersionId', 12);
    set('draftVersionNo', 4);
    await settle(fixture);
    const link = el().querySelector<HTMLAnchorElement>('[data-open-draft]')!;
    expect(link.textContent).toContain('Open draft v4');
    expect(link.getAttribute('href')).toBe('/admin/workflows/1/versions/12');
    expect(labels()).toEqual(['Open draft v4', 'More version actions']);
  });

  it('has no overflow for a retired version', async () => {
    await settle(fixture);
    expect(el().querySelector('[data-overflow]')).toBeNull();
  });
});
