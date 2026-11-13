import {
  VendorContactResponse,
  VendorMatterResponse,
  VendorOptionView,
  VendorResponse,
} from '../../api/generated/api-client';

/** A vendor as the Vendors list and detail return it (a Preferred vendor with two services, one area and one contact). */
export function aVendor(over: Partial<VendorResponse> = {}): VendorResponse {
  return {
    vendorId: 7,
    name: 'Northbridge eDiscovery',
    website: 'northbridge.example',
    category: 'PREFERRED',
    note: 'Fast turnaround on large reviews.',
    services: [
      { id: 1, name: 'Hosting', isActive: true },
      { id: 2, name: 'Review', isActive: true },
    ],
    areas: [{ id: 10, name: 'Northeast', isActive: true }],
    techAi: ['Relativity aiR'],
    contactCount: 1,
    doNotHireCount: 0,
    matterCount: 0,
    modifiedAt: '2026-11-10T15:00:00Z',
    rowVersion: 'RV1',
    ...over,
  };
}

/** A contact of a vendor (a person from People with no flag). */
export function aContact(over: Partial<VendorContactResponse> = {}): VendorContactResponse {
  return {
    contactId: 21,
    vendorId: 7,
    personId: 11,
    personName: 'Laura Whitfield',
    personType: 'EXTERNAL',
    personTitle: 'Account Executive',
    personEmail: 'laura.whitfield@northbridge.example',
    personCompany: 'Northbridge eDiscovery',
    personIsActive: true,
    flag: 'NONE',
    reportedOn: undefined,
    reportedByUserId: undefined,
    reportedByName: undefined,
    note: undefined,
    rowVersion: 'CV1',
    ...over,
  };
}

/** A matter a vendor is linked to. */
export function aVendorMatter(over: Partial<VendorMatterResponse> = {}): VendorMatterResponse {
  return {
    matterId: 301,
    matterRef: '00343-00012',
    matterName: 'Acme v. Orion',
    clientName: 'Acme Corp',
    isActive: true,
    linkedAt: '2026-11-02T10:00:00Z',
    linkedByName: 'Maria Alvarez',
    ...over,
  };
}

/** An item of the Services or Areas list. */
export function anOption(over: Partial<VendorOptionView> = {}): VendorOptionView {
  return {
    id: 1,
    name: 'Hosting',
    sortOrder: 1,
    isActive: true,
    rowVersion: 'OV1',
    inUseCount: 0,
    ...over,
  };
}

export const pageOfVendors = (...items: VendorResponse[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
});
