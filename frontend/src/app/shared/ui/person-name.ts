/**
 * The name to show for a person: a display name stays as it is; a bare Windows account ("KE\kekim") or an address ("kekim@firm.test") shows the account part only
 * ("kekim"), because the domain says nothing to a reader. Used where the server sends the account in place of a display name (the Matter Summary; MD-42, #1060).
 * A name with a space is a real display name and is never touched.
 */
export function shortAccountName(name: string | null | undefined): string {
  const text = (name ?? '').trim();
  if (text === '' || /\s/.test(text)) return text;
  if (text.includes('\\')) return text.slice(text.lastIndexOf('\\') + 1) || text;
  const at = text.indexOf('@');
  return at > 0 ? text.slice(0, at) : text;
}
