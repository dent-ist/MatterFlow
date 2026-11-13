import { ApiError } from '../../core/http/api-error';
import { metaNumber } from '../../shared/forms/api-errors';

/** The words of the Vendors screens in one place (D-20, section 4.3 of the guidelines), so the specs and the screens agree. */
export const VENDOR_MESSAGES = {
  name: 'Enter the vendor name.',
  category: 'Choose a category.',
  website: 'Enter a website address like https://www.example.com.',
  conflict: 'This vendor was changed by someone else. Close the dialog and open it again.',
  failed: "Couldn't save the vendor.",
  deleteFailed: "Couldn't delete the vendor.",
  noMatters: "You don't have access to Matters, so the linked matters are not listed.",
  readOnly: 'Read only. Changing vendors needs the Vendor.Manage permission.',
} as const;

/** What the delete answers when a vendor is linked to matters (409 `VENDOR_LINKED_TO_MATTERS`, `meta.matterCount`): the sentence the block shows. */
export function linkedBlockText(count: number): string {
  const matters = count === 1 ? '1 matter' : `${count} matters`;
  return `This vendor is linked to ${matters} and cannot be deleted. Unlink it from ${count === 1 ? 'the matter' : 'each matter'} first, or set its category to Blacklisted.`;
}

/** The answer of a failed delete as text for the person: the linked-matters block with its count, or the general failure. `linked` is the count, 0 when it is another failure. */
export function deleteFailure(err: unknown): { text: string; linked: number } {
  if (err instanceof ApiError && err.code === 'VENDOR_LINKED_TO_MATTERS') {
    const linked = metaNumber(err, 'matterCount') ?? 0;
    return { text: linkedBlockText(linked), linked };
  }
  return {
    text: `${VENDOR_MESSAGES.deleteFailed} ${(err as Error)?.message ?? ''}`.trim(),
    linked: 0,
  };
}

/** "Services" and "Areas" of a vendor as one clipped line ("Hosting, Review +2" is the tooltip's job: the whole list). */
export function namesOf(options: readonly { name: string }[]): string {
  return options.map((o) => o.name).join(', ');
}
