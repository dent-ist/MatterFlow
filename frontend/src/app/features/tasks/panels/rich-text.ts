/** Helpers for the basic rich text of Task comments (bold, italic, lists, links). The server sanitizes again; the UI renders only sanitized HTML. */

/** Largest plain-text length the comment editor accepts (UX 5.5 proposal). */
export const COMMENT_MAX_TEXT = 10_000;

/** Largest plain-text length of a Task description (the server limit; decision R). */
export const DESCRIPTION_MAX_TEXT = 20_000;

/** Most table cells one comment or description may hold (the server limit; decision R). */
export const MAX_TABLE_CELLS = 200;

/** Deepest nesting of tables kept; deeper ones are flattened (the server does the same). */
export const MAX_TABLE_DEPTH = 3;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const NEVER_RENDERED =
  'img,picture,source,video,audio,track,iframe,frame,object,embed,form,input,button,select,textarea,svg,math,style,link,meta,base,script';

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

/**
 * Plain text as HTML, like the server's conversion: everything escaped, a blank line starts a paragraph and a single line break becomes a
 * `<br>`. Shows descriptions saved as text (before descriptions became rich text) and starts their editing.
 */
export function textToHtml(text: string | null | undefined): string {
  const normalized = (text ?? '').replace(/\r\n?/g, '\n').replace(/^[\n \t]+|[\n \t]+$/g, '');
  if (normalized.trim().length === 0) return '';
  return normalized
    .split(/\n[ \t]*\n+/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .split('\n')
          .map((line) => escapeText(line.replace(/\s+$/, '')))
          .join('<br>')}</p>`,
    )
    .join('');
}

/** The HTML to show or edit for a Task description in either storage format (`TEXT` is escaped, `HTML` is already sanitized). */
export function descriptionToHtml(
  description: string | null | undefined,
  format: string | null | undefined,
): string {
  if (!description) return '';
  return format === 'HTML' ? description : textToHtml(description);
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'tr',
  'table',
  'caption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
]);

/**
 * The text of an HTML fragment for summaries: paragraphs, list items, line breaks and table rows end a line and table cells are separated by
 * ` | ` (the server's plain-text rendering of a description). Parsed into an inert document; nothing is executed or fetched.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const newline = (): void => {
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  };
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? '').replace(/[ \t\r\n\f]+/g, ' ');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).localName;
        if (tag === 'br') {
          out += '\n';
          continue;
        }
        const block = BLOCK_TAGS.has(tag);
        if (block) newline();
        walk(child);
        if (tag === 'td' || tag === 'th') out += ' | ';
        if (block) newline();
      }
    }
  };
  walk(doc.body);
  return out
    .replace(/(?:[ \u00A0]*\|[ \u00A0]*)+(?=\n|$)/g, '')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  // The server never stores these. Dropping them here keeps a remote image (a tracking pixel) from loading even if one were stored, because
  // Angular's own sanitizer would let a plain <img src> through.
  for (const element of Array.from(doc.body.querySelectorAll(NEVER_RENDERED))) element.remove();
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

// ---- table cells (used by the editor's keyboard handling, which cannot wait for a lazy chunk)

/** The cell that holds the caret (the innermost one), when the selection is inside `area`. */
export function cellAtSelection(
  area: HTMLElement,
  selection: Selection | null,
): HTMLTableCellElement | null {
  const node = selection?.anchorNode;
  if (!node || !area.contains(node)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const cell = element?.closest('td, th');
  return cell && area.contains(cell) ? (cell as HTMLTableCellElement) : null;
}

/** The next (or previous) cell of the same table in reading order, or null at the end (Tab then leaves the editor). */
export function neighbourCell(
  cell: HTMLTableCellElement,
  backward: boolean,
): HTMLTableCellElement | null {
  const table = cell.closest('table');
  if (!table) return null;
  const cells = Array.from(table.rows).flatMap((tr) => Array.from(tr.cells));
  return cells[cells.indexOf(cell) + (backward ? -1 : 1)] ?? null;
}

/** Puts the caret at the start of a cell. */
export function placeCaret(cell: Element, selection: Selection | null): void {
  if (!selection) return;
  const range = cell.ownerDocument.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
