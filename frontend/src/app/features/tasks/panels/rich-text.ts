/** Helpers for the basic rich text of Task comments (bold, italic, lists, links). The server sanitizes again; the UI renders only sanitized HTML. */

/** Largest plain-text length the comment editor accepts (UX 5.5 proposal). */
export const COMMENT_MAX_TEXT = 10_000;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The link the editor may insert for what the user typed: `http(s)://...` and `mailto:` are accepted as typed, a bare host such as
 * `example.com/doc` gets `https://`, and anything else (javascript:, data:, relative paths, spaces) is rejected with `null`.
 */
export function normalizeLink(input: string | null | undefined): string | null {
  const text = (input ?? '').trim();
  if (text.length === 0 || text.length > 2000 || hasWhitespaceOrControl(text)) return null;

  if (SCHEME.test(text)) {
    return /^(https?:\/\/[^/?#]+|mailto:[^@\s]+@[^@\s]+)/i.test(text) ? text : null;
  }
  if (text.startsWith('//') || text.startsWith('/')) return null;
  return /^[^@/?#\s]+\.[^@/?#\s]{2,}([/?#].*)?$/.test(text) ? `https://${text}` : null;
}

/** Visible text of an HTML fragment (never executes anything: parsed into an inert document). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** True when the HTML shows nothing but whitespace (empty paragraphs and line breaks count as nothing). */
export function isBlankHtml(html: string | null | undefined): boolean {
  return htmlToText(html).trim().length === 0;
}

function hasWhitespaceOrControl(text: string): boolean {
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x20 || /\s/.test(char)) return true;
  }
  return false;
}
