import { VENDOR_CATEGORIES, vendorCategory } from './vendor-badges';
import { draftChanged, draftOf, emptyDraft } from './vendor-form';
import { deleteFailure, linkedBlockText, namesOf } from './vendor-text';
import { ApiError } from '../../core/http/api-error';
import { HttpErrorResponse } from '@angular/common/http';
import { aVendor } from '../../shared/testing/vendors-testing';

describe('vendor drafts', () => {
  it('starts empty as Neutral and reads a vendor back into a draft', () => {
    expect(emptyDraft()).toMatchObject({ name: '', category: 'NEUTRAL', serviceIds: [] });
    expect(draftOf(aVendor())).toEqual({
      name: 'Northbridge eDiscovery',
      website: 'northbridge.example',
      category: 'PREFERRED',
      serviceIds: [1, 2],
      areaIds: [10],
      techAi: ['Relativity aiR'],
      note: 'Fast turnaround on large reviews.',
    });
  });

  it('notices a change in any field, ignores surrounding spaces and the order of the choices', () => {
    const base = draftOf(aVendor());
    expect(draftChanged(base, { ...base })).toBe(false);
    expect(draftChanged(base, { ...base, name: ' Northbridge eDiscovery ' })).toBe(false);
    expect(draftChanged(base, { ...base, serviceIds: [2, 1] })).toBe(false);
    expect(draftChanged(base, { ...base, name: 'Other' })).toBe(true);
    expect(draftChanged(base, { ...base, category: 'BLACKLISTED' })).toBe(true);
    expect(draftChanged(base, { ...base, category: 'NEUTRAL' })).toBe(true);
    expect(draftChanged(base, { ...base, areaIds: [] })).toBe(true);
    expect(draftChanged(base, { ...base, techAi: [] })).toBe(true);
    expect(draftChanged(base, { ...base, note: 'x' })).toBe(true);
  });
});

describe('vendor words', () => {
  it('names the three categories with an icon and a word each; Neutral is plain grey, no warning colour', () => {
    expect(VENDOR_CATEGORIES.map((c) => c.label)).toEqual(['Preferred', 'Neutral', 'Blacklisted']);
    expect(vendorCategory('NEUTRAL')).toMatchObject({ label: 'Neutral', tone: 'neutral' });
    expect(vendorCategory('PREFERRED')).toMatchObject({ label: 'Preferred', icon: 'pi-verified' });
    expect(vendorCategory('BLACKLISTED')).toMatchObject({ label: 'Blacklisted', icon: 'pi-ban' });
  });

  it('says how many matters block a delete, in the singular and the plural', () => {
    expect(linkedBlockText(1)).toContain('linked to 1 matter and');
    expect(linkedBlockText(1)).toContain('Unlink it from the matter first');
    expect(linkedBlockText(4)).toContain('linked to 4 matters and');
    expect(linkedBlockText(4)).toContain('Unlink it from each matter first');
  });

  it('reads the count of a 409 VENDOR_LINKED_TO_MATTERS and treats any other failure as a plain failure', () => {
    const conflict = ApiError.from(
      new HttpErrorResponse({
        status: 409,
        error: { status: 409, code: 'VENDOR_LINKED_TO_MATTERS', meta: { matterCount: 3 } },
      }),
    );
    expect(deleteFailure(conflict)).toEqual({ text: linkedBlockText(3), linked: 3 });
    expect(deleteFailure(new Error('boom'))).toEqual({
      text: "Couldn't delete the vendor. boom",
      linked: 0,
    });
  });

  it('joins the names of services and areas', () => {
    expect(namesOf([{ name: 'Hosting' }, { name: 'Review' }])).toBe('Hosting, Review');
    expect(namesOf([])).toBe('');
  });
});
