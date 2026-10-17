import { aRow } from './work-queue-testing';
import { hasStepLink, stepLinkLabel, stepQueryParams } from './step-link';

describe('step link', () => {
  it('opens the Workflow section with the step', () => {
    expect(stepQueryParams(903)).toEqual({ tab: 'workflow', step: 903 });
  });

  it('is a link for an open task that names its current step', () => {
    expect(hasStepLink(aRow())).toBe(true);
  });

  it('is plain text when every step is resolved, the id is missing or the task is closed', () => {
    const w = aRow().workflow;
    const none = { ...w, currentStepName: undefined, currentStepId: undefined };
    expect(hasStepLink(aRow({ workflow: none }))).toBe(false);
    expect(hasStepLink(aRow({ workflow: { ...w, currentStepId: undefined } }))).toBe(false);
    expect(hasStepLink(aRow({ status: 'COMPLETED' }))).toBe(false);
    expect(hasStepLink(aRow({ status: 'CANCELLED' }))).toBe(false);
  });

  it('names progress, step and action', () => {
    expect(stepLinkLabel(aRow())).toBe(
      'Workflow progress: 2 of 6 done, current step Dedup. Open step.',
    );
  });
});
