/**
 * The initials of a person's avatar, from whatever name the server has: a display name ("Dana Whitfield" gives DW, "Mary Jane Smith" gives MS), a Windows account
 * ("KE\kekim" gives KE: the domain is not a name), an address ("dana.whitfield@firm.test" gives DW), a single name ("Dana" gives DA) or nothing (a question mark,
 * only when there truly is no name). One helper for every avatar of the app.
 */
export function personInitials(name: string | null | undefined): string {
  let text = (name ?? '').trim();
  if (text.includes('\\')) text = text.slice(text.lastIndexOf('\\') + 1);
  const at = text.indexOf('@');
  if (at > 0) text = text.slice(0, at);
  const words = text.split(/[^\p{L}\p{N}'\u2019]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last =
    words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : ([...words[0]][1] ?? '');
  return (first + last).toUpperCase();
}
