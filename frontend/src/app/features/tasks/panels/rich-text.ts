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

/** Bidirectional control characters: they can reorder what a link shows so that the text no longer reads as the address behind it. */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/;
/** Link text that itself looks like a web address (`example.com`, `https://example.com/x`). */
const ADDRESS_TEXT = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?$/i;

export const LINK_WARNING_CREDENTIALS =
  'This link contains a user name or password before the host. Check where it really goes.';
export const LINK_WARNING_BIDI =
  'This link contains hidden direction characters that can disguise its address.';
export const LINK_WARNING_MISMATCH =
  'The link text names a different site than the one the link opens.';

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/**
 * Decorates the links of a (server-sanitized) comment body: every `http(s)` link opens in a new tab and is followed by the real host it goes
 * to in parentheses, and a warning mark follows links that look deceptive: credentials in the address (`https://google.com@evil.example`),
 * bidirectional control characters, or link text that names another site than the address (SEC2-12). The server already drops the first two forms;
 * this keeps older comments honest and covers the third. Works on an inert parsed document and returns HTML for Angular's sanitizer.
 */
export function decorateLinks(html: string | null | undefined): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const anchor of Array.from(doc.body.querySelectorAll('a'))) {
    anchor.setAttribute('target', '_blank');

    const href = anchor.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    const text = anchor.textContent ?? '';
    const warnings: string[] = [];
    if (url.username !== '' || url.password !== '') warnings.push(LINK_WARNING_CREDENTIALS);
    if (BIDI.test(href) || BIDI.test(text)) warnings.push(LINK_WARNING_BIDI);
    const named = ADDRESS_TEXT.exec(text.trim());
    if (named && stripWww(named[1]) !== stripWww(url.hostname))
      warnings.push(LINK_WARNING_MISMATCH);

    const host = doc.createElement('span');
    host.className = 'tc__host';
    host.textContent = `(${url.host})`;
    anchor.after(host);

    if (warnings.length > 0) {
      const mark = doc.createElement('span');
      mark.className = 'tc__warn';
      mark.setAttribute('role', 'img');
      mark.setAttribute('title', warnings.join(' '));
      mark.setAttribute('aria-label', `Warning: ${warnings.join(' ')}`);
      mark.textContent = '⚠';
      host.after(mark);
    }
  }
  return doc.body.innerHTML;
}

function hasWhitespaceOrControl(text: string): boolean {
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x20 || /\s/.test(char)) return true;
  }
  return false;
}
