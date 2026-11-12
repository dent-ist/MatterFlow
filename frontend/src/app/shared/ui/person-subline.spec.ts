import { personSubline } from './person-subline';

describe('personSubline', () => {
  it('puts the title first, then the company of an external person, otherwise the e-mail', () => {
    expect(
      personSubline({ title: 'Partner', companyName: 'Hartman & Pike LLP', email: 'v@x.example' }),
    ).toBe('Partner, Hartman & Pike LLP');
    expect(personSubline({ title: 'Pod Lead', email: 'priya@lawfirm.example' })).toBe(
      'Pod Lead, priya@lawfirm.example',
    );
  });

  it('leaves out what is not known', () => {
    expect(personSubline({ email: 'a@b.example' })).toBe('a@b.example');
    expect(personSubline({ title: 'Partner', companyName: ' ', email: null })).toBe('Partner');
    expect(personSubline({})).toBe('');
  });
});
