import { InjectionToken } from '@angular/core';

/**
 * Switches for the AI features of the Matter detail redesign (MD-16, #1017; owner decision AQ.10). `aiPolicyCheck` is the future check that runs when a
 * note is saved and may show the warning dialog. It is OFF in every environment in release 1: only the dialog component exists. Provide another value in a
 * spec to exercise the dialog; never turn it on in the application until the check exists.
 */
export interface AiFlags {
  aiPolicyCheck: boolean;
}

export const AI_FLAGS = new InjectionToken<AiFlags>('AI_FLAGS', {
  providedIn: 'root',
  factory: () => ({ aiPolicyCheck: false }),
});
