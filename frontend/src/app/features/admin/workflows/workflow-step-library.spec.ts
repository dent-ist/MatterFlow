import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StepDefinitionSummary, StepDefinitionsClient } from '../../../api/generated/api-client';
import { ok, settle } from '../../../shared/testing/org-testing';
import { LIBRARY_PAGE_SIZE, StepLibraryModel, WorkflowStepLibrary } from './workflow-step-library';

const step = (id: number, title: string): StepDefinitionSummary =>
  ({
    stepDefinitionId: id,
    title,
    description: undefined,
    isActive: true,
    tags: [],
  }) as unknown as StepDefinitionSummary;

describe('step library (VP3, #396)', () => {
  let api: {
    listStepDefinitions: ReturnType<typeof vi.fn>;
    listStepTags: ReturnType<typeof vi.fn>;
  };
  let model: StepLibraryModel;

  beforeEach(() => {
    api = {
      listStepDefinitions: vi.fn().mockReturnValue(
        ok({
          items: [step(1, 'Intake'), step(2, 'Load'), step(3, 'OCR')],
          total: 60,
          page: 1,
          pageSize: 50,
        }),
      ),
      listStepTags: vi.fn().mockReturnValue(ok([{ name: 'QC', stepCount: 2 }])),
    };
    model = new StepLibraryModel(api as unknown as StepDefinitionsClient);
  });

  it('loads the first page of active steps and says when there are more than it shows', async () => {
    await model.load();
    expect(api.listStepDefinitions).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      1,
      LIBRARY_PAGE_SIZE,
    );
    expect(model.state()).toBe('ready');
    expect(model.countText()).toBe('Showing the first 3 of 60 steps. Search to narrow the list.');
    await model.loadTags();
    expect(model.tagOptions()).toEqual([{ name: 'QC', count: 2 }]);
  });

  it('counts a short library plainly and reports a failed load', async () => {
    api.listStepDefinitions.mockReturnValue(
      ok({ items: [step(1, 'Intake')], total: 1, page: 1, pageSize: 50 }),
    );
    await model.load();
    expect(model.countText()).toBe('1 step');
    api.listStepDefinitions.mockImplementation(() => {
      throw new Error('down');
    });
    await model.load();
    expect(model.state()).toBe('error');
  });

  describe('panel', () => {
    let fixture: ComponentFixture<WorkflowStepLibrary>;
    const el = (): HTMLElement => fixture.nativeElement;

    beforeEach(async () => {
      await model.load();
      fixture = TestBed.createComponent(WorkflowStepLibrary);
      fixture.componentRef.setInput('model', model);
      fixture.componentRef.setInput('addedIds', new Set([1]));
      await settle(fixture);
    });

    it('lists the steps with Add buttons; a step already in the version shows Added and is off', () => {
      const first = el().querySelector<HTMLButtonElement>('[data-add="1"]')!;
      expect(first.disabled).toBe(true);
      expect(first.textContent).toContain('Added');
      expect(first.getAttribute('aria-label')).toBe('Intake is already in the workflow');
      expect(el().querySelector<HTMLButtonElement>('[data-add="2"]')!.textContent).toContain('Add');
      expect(el().querySelector('[data-lib-count]')?.textContent).toContain(
        'Showing the first 3 of 60',
      );
      expect(el().querySelector('[data-lib-added]')?.textContent?.trim()).toBe('');
    });

    it('keeps the panel open for several adds and counts them', async () => {
      const added: string[] = [];
      fixture.componentInstance.add.subscribe((s) => added.push(s.title));
      el().querySelector<HTMLButtonElement>('[data-add="2"]')!.click();
      fixture.componentRef.setInput('addedIds', new Set([1, 2]));
      await settle(fixture);
      el().querySelector<HTMLButtonElement>('[data-add="3"]')!.click();
      fixture.componentRef.setInput('addedIds', new Set([1, 2, 3]));
      await settle(fixture);
      expect(added).toEqual(['Load', 'OCR']);
      expect(el().querySelector('[data-lib-added]')?.textContent?.trim()).toBe('2 added');
      // Nothing left to add: focus goes to the search box.
      expect(document.activeElement?.id ?? el().querySelector('#wf-lib-search')?.id).toBe(
        'wf-lib-search',
      );
    });
  });
});
