import { PersonDto, PersonLookupItem } from '../../api/generated/api-client';

/** A People record as the lookup returns it (an external person by default). */
export function aLookupPerson(over: Partial<PersonLookupItem> = {}): PersonLookupItem {
  return {
    personId: 11,
    displayName: 'Laura Whitfield',
    personType: 'EXTERNAL',
    title: 'Account Executive',
    email: 'laura.whitfield@northbridge.example',
    companyName: 'Northbridge eDiscovery',
    userId: undefined,
    isSystemUser: false,
    ...over,
  };
}

/** A full person as the People list and detail return it. */
export function aPerson(over: Partial<PersonDto> = {}): PersonDto {
  return {
    personId: 11,
    firstName: 'Laura',
    lastName: 'Whitfield',
    displayName: 'Laura Whitfield',
    personType: 'EXTERNAL',
    title: 'Account Executive',
    email: 'laura.whitfield@northbridge.example',
    comments: undefined,
    companyName: 'Northbridge eDiscovery',
    userId: undefined,
    isSystemUser: false,
    userIsActive: undefined,
    isActive: true,
    rowVersion: 'RV1',
    ...over,
  };
}
