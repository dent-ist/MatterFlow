import { personKind } from './person-type';

describe('personKind', () => {
  it('names a system user first, then Internal and External, each with an icon and a tone', () => {
    expect(personKind({ personType: 'INTERNAL', isSystemUser: true })).toMatchObject({
      kind: 'system',
      label: 'System User',
      icon: 'pi-user',
    });
    expect(personKind({ personType: 'INTERNAL', isSystemUser: false })).toMatchObject({
      kind: 'internal',
      label: 'Internal',
      tone: 'info',
    });
    expect(personKind({ personType: 'EXTERNAL', isSystemUser: false })).toMatchObject({
      kind: 'external',
      label: 'External',
      tone: 'neutral',
      icon: 'pi-globe',
    });
  });
});
