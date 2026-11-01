import { MatterAiAllowed } from '../../../api/generated/api-client';

/** The three values of the Matter field "AI allowed" (MD-02, #1003; owner decision AQ.3), in the order the form offers them. */
export const AI_OPTIONS: readonly { value: MatterAiAllowed; label: string; chip: string }[] = [
  { value: MatterAiAllowed.No, label: 'No', chip: 'AI: No' },
  { value: MatterAiAllowed.OnPremOnly, label: 'On-prem AI only', chip: 'AI: On-prem only' },
  {
    value: MatterAiAllowed.CompanyApproved,
    label: 'Company-approved AI services',
    chip: 'AI: Company-approved',
  },
];

/** The form label of a value ("On-prem AI only"); a missing value counts as No. */
export function aiLabel(v: MatterAiAllowed | undefined | null): string {
  return (AI_OPTIONS.find((o) => o.value === v) ?? AI_OPTIONS[0]).label;
}

/** The header chip text ("AI: On-prem only"). */
export function aiChip(v: MatterAiAllowed | undefined | null): string {
  return (AI_OPTIONS.find((o) => o.value === v) ?? AI_OPTIONS[0]).chip;
}
