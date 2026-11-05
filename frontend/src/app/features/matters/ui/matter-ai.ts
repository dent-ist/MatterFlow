import { MatterAiAllowed } from '../../../api/generated/api-client';

/** The three values of the Matter field "AI allowed" (MD-02, #1003; owner decision AQ.3), in the order the form offers them. */
export const AI_OPTIONS: readonly { value: MatterAiAllowed; label: string; chip: string }[] = [
  { value: MatterAiAllowed.No, label: 'No', chip: 'AI: No' },
  { value: MatterAiAllowed.OnPremOnly, label: 'On-Prem AI Only', chip: 'AI: On-Prem Only' },
  {
    value: MatterAiAllowed.CompanyApproved,
    label: 'Company-Approved AI Services',
    chip: 'AI: Company-Approved',
  },
];

/** The form label of a value ("On-Prem AI Only"); a missing value counts as No. */
export function aiLabel(v: MatterAiAllowed | undefined | null): string {
  return (AI_OPTIONS.find((o) => o.value === v) ?? AI_OPTIONS[0]).label;
}

/** The header chip text ("AI: On-Prem Only"). */
export function aiChip(v: MatterAiAllowed | undefined | null): string {
  return (AI_OPTIONS.find((o) => o.value === v) ?? AI_OPTIONS[0]).chip;
}
