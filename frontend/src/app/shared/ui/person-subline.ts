/**
 * The muted second line of a person in a list or a picker (epic #1373): the person's own title or role, then the company of an external person, otherwise the e-mail address
 * ("Partner, Hartman & Pike LLP", "Pod Lead, priya.nair@lawfirm.example"). Empty parts are left out; nothing known gives an empty string.
 */
export function personSubline(p: {
  title?: string | null;
  companyName?: string | null;
  email?: string | null;
}): string {
  return [p.title, p.companyName || p.email]
    .filter((part) => !!part && part.trim() !== '')
    .join(', ');
}
