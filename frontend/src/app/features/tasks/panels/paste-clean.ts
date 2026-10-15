/**
 * Clean-up of HTML pasted or dropped into the rich text editor (decision R). Outlook, Word, web pages and spreadsheets put heavy markup on the
 * clipboard: styles, classes, `mso-*` properties, conditional comments, `o:p`, fonts, spans. This rebuilds the content from a short allow-list
 * into new elements (nothing from the source is moved over), so only these survive: paragraphs, line breaks, bold, italic, underline, bulleted
 * and numbered lists, `http(s)`/`mailto` links, and tables with `colspan`, `rowspan` and `scope`. Everything else is unwrapped or dropped (scripts,
 * styles, images, forms, SVG, comments), every attribute is dropped. The server sanitizes again with the same rules; this keeps what the person
 * sees while editing equal to what will be saved, and keeps hostile markup out of the editable area in the first place.
 *
 * The source is parsed by `DOMParser`: an inert document, so nothing runs and nothing is fetched while it is read. Loaded on demand with the table tools.
 */
import { MAX_TABLE_CELLS, MAX_TABLE_DEPTH, normalizeLink } from './rich-text';

export type CleanedPaste =
  | { readonly kind: 'html'; readonly html: string; readonly cells: number }
  | { readonly kind: 'text'; readonly reason: 'too-many-cells' | 'too-large' | 'empty' };

/** Largest clipboard HTML examined (characters); more is pasted as plain text. */
export const MAX_PASTE_HTML = 2_000_000;

const DROPPED = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'textarea',
  'select',
  'button',
  'input',
  'img',
  'picture',
  'video',
  'audio',
  'canvas',
  'frame',
  'frameset',
  'applet',
  'xmp',
  'noembed',
  'noframes',
  'o:p',
  'xml',
  'form',
]);

/** Elements that become paragraphs (a block that holds blocks only passes its children through). */
const BLOCKS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'section',
  'article',
  'address',
  'center',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'fieldset',
  'legend',
]);

const OUTPUT_BLOCKS = new Set(['p', 'ul', 'ol', 'li', 'table']);
const TABLE_PARTS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
]);
const SCOPES = new Set(['row', 'col', 'rowgroup', 'colgroup']);
const BIDI_OVERRIDES = /[‪-‮]/g;

interface Context {
  readonly doc: Document;
  cells: number;
  overflow: boolean;
}

/** Cleans clipboard HTML; a table over the cell limit (or an unmanageably large paste) is refused so the caller pastes the plain text instead. */
export function cleanPastedHtml(html: string): CleanedPaste {
  if (html.length > MAX_PASTE_HTML) return { kind: 'text', reason: 'too-large' };

  const source = new DOMParser().parseFromString(html, 'text/html');
  const context: Context = {
    doc: document.implementation.createHTMLDocument(''),
    cells: 0,
    overflow: false,
  };
  const container = context.doc.createElement('div');
  const nodes = walkChildren(source.body, context, 0);
  if (context.overflow) return { kind: 'text', reason: 'too-many-cells' };
  // Loose text beside blocks gets paragraphs; a paste of inline content only stays inline.
  for (const node of nodes.some((n) => isBlockNode(n)) ? groupInline(nodes, context) : nodes) {
    container.appendChild(node);
  }

  dropEmptyBlocks(container);
  dropLayoutWhitespace(container);
  if ((container.textContent ?? '').trim().length === 0 && !container.querySelector('td, th, li')) {
    return { kind: 'text', reason: 'empty' };
  }
  return { kind: 'html', html: container.innerHTML, cells: context.cells };
}

function walkChildren(parent: Node, context: Context, tableDepth: number): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(parent.childNodes)) out.push(...walk(child, context, tableDepth));
  return out;
}

function walk(node: Node, context: Context, tableDepth: number): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/[ \t\r\n\f]+/g, ' ').replace(BIDI_OVERRIDES, '');
    return text.length === 0 ? [] : [context.doc.createTextNode(text)];
  }
  if (node.nodeType !== Node.ELEMENT_NODE || context.overflow) return [];

  const element = node as Element;
  const tag = element.localName;
  if (DROPPED.has(tag)) return [];

  if (TABLE_PARTS.has(tag)) return table(element, tag, context, tableDepth);

  switch (tag) {
    case 'br':
      return [context.doc.createElement('br')];
    case 'b':
    case 'strong':
      return isNormalWeight(element)
        ? walkChildren(element, context, tableDepth)
        : wrap('b', element, context, tableDepth);
    case 'i':
    case 'em':
      return wrap('i', element, context, tableDepth);
    case 'u':
      return wrap('u', element, context, tableDepth);
    case 'a':
      return link(element, context, tableDepth);
    case 'ul':
    case 'ol':
      return list(element, tag, context, tableDepth);
    case 'li':
      // A stray item outside a list becomes a paragraph.
      return block(element, context, tableDepth);
    case 'span':
    case 'font':
      return styled(element, context, tableDepth);
    default:
      return BLOCKS.has(tag)
        ? block(element, context, tableDepth)
        : walkChildren(element, context, tableDepth);
  }
}

function wrap(name: string, element: Element, context: Context, tableDepth: number): Node[] {
  const children = walkChildren(element, context, tableDepth);
  if (children.length === 0) return [];
  if (children.some((child) => isBlockNode(child))) return children;
  const created = context.doc.createElement(name);
  for (const child of children) created.appendChild(child);
  return [created];
}

/** `<b style="font-weight:normal">` is the wrapper Google Docs puts around a whole clipboard, not bold text. */
function isNormalWeight(element: Element): boolean {
  return /font-weight\s*:\s*(normal|400|300|200|100)\b/i.test(element.getAttribute('style') ?? '');
}

/** Spans and fonts carry bold, italic or underline as styles in Outlook and Word; those are kept as real formatting. */
function styled(element: Element, context: Context, tableDepth: number): Node[] {
  const style = (element.getAttribute('style') ?? '').toLowerCase();
  let nodes = walkChildren(element, context, tableDepth);
  if (nodes.length === 0 || nodes.some((n) => isBlockNode(n))) return nodes;
  const formats: string[] = [];
  if (/font-weight\s*:\s*(bold|bolder|[6-9]00)\b/.test(style)) formats.push('b');
  if (/font-style\s*:\s*italic/.test(style)) formats.push('i');
  if (/text-decoration[^;]*underline/.test(style)) formats.push('u');
  for (const name of formats) {
    const created = context.doc.createElement(name);
    for (const n of nodes) created.appendChild(n);
    nodes = [created];
  }
  return nodes;
}

function link(element: Element, context: Context, tableDepth: number): Node[] {
  const children = walkChildren(element, context, tableDepth);
  const href = normalizeLink(element.getAttribute('href'));
  if (!href || children.length === 0 || children.some((child) => isBlockNode(child)))
    return children;
  const anchor = context.doc.createElement('a');
  anchor.setAttribute('href', href);
  for (const child of children) anchor.appendChild(child);
  return [anchor];
}

function list(element: Element, tag: 'ul' | 'ol', context: Context, tableDepth: number): Node[] {
  const created = context.doc.createElement(tag);
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).localName === 'li') {
      const item = context.doc.createElement('li');
      for (const part of walkChildren(child, context, tableDepth)) item.appendChild(part);
      if ((item.textContent ?? '').trim().length > 0 || item.querySelector('ul, ol, table')) {
        created.appendChild(item);
      }
    } else {
      // Anything else directly in a list (a nested list, loose text) is kept as an item so it is not lost.
      const parts = walk(child, context, tableDepth);
      if (
        parts.length === 0 ||
        parts.every((p) => p.nodeType === Node.TEXT_NODE && !(p.textContent ?? '').trim())
      )
        continue;
      const item = context.doc.createElement('li');
      for (const part of parts) item.appendChild(part);
      created.appendChild(item);
    }
  }
  return created.children.length === 0 ? [] : [created];
}

/** A block element: a paragraph around inline content, or just its children when they are blocks themselves. */
function block(element: Element, context: Context, tableDepth: number): Node[] {
  const children = walkChildren(element, context, tableDepth);
  if (children.length === 0) return [];
  if (children.some((child) => isBlockNode(child))) return groupInline(children, context);
  const paragraph = context.doc.createElement('p');
  for (const child of children) paragraph.appendChild(child);
  return [paragraph];
}

/** Loose inline nodes that sit beside blocks are wrapped in paragraphs so line breaks survive. */
function groupInline(children: Node[], context: Context): Node[] {
  const out: Node[] = [];
  let run: Node[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const text = run.map((n) => n.textContent ?? '').join('');
    if (text.trim().length > 0 || run.some((n) => n.nodeName === 'BR')) {
      const paragraph = context.doc.createElement('p');
      for (const n of run) paragraph.appendChild(n);
      out.push(paragraph);
    }
    run = [];
  };
  for (const child of children) {
    if (isBlockNode(child)) {
      flush();
      out.push(child);
    } else run.push(child);
  }
  flush();
  return out;
}

function isBlockNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && OUTPUT_BLOCKS.has((node as Element).localName);
}

function table(element: Element, tag: string, context: Context, tableDepth: number): Node[] {
  const depth = tag === 'table' ? tableDepth + 1 : tableDepth;
  const flattened = depth > MAX_TABLE_DEPTH;

  if (flattened) {
    // Deeper than the server keeps: rows and cells become paragraphs, the rest passes through.
    if (tag === 'tr' || tag === 'td' || tag === 'th' || tag === 'caption')
      return block(element, context, depth);
    return tag === 'col' ? [] : walkChildren(element, context, depth);
  }

  if (tag === 'col') return [context.doc.createElement('col')];

  const created = context.doc.createElement(tag);
  if (tag === 'td' || tag === 'th') {
    if (++context.cells > MAX_TABLE_CELLS) {
      context.overflow = true;
      return [];
    }
    for (const name of ['colspan', 'rowspan']) {
      const value = /^\s*(\d{1,3})\s*$/.exec(element.getAttribute(name) ?? '');
      const n = value ? Number(value[1]) : 0;
      if (n > 1 && n <= 100) created.setAttribute(name, String(n));
    }
    if (tag === 'th') {
      const scope = (element.getAttribute('scope') ?? '').trim().toLowerCase();
      if (SCOPES.has(scope)) created.setAttribute('scope', scope);
    }
  }

  const structural =
    tag === 'table' ||
    tag === 'thead' ||
    tag === 'tbody' ||
    tag === 'tfoot' ||
    tag === 'tr' ||
    tag === 'colgroup';
  for (const child of Array.from(element.childNodes)) {
    if (structural) {
      // Between table parts only table parts count; stray text and elements are dropped (the parser would move them out of the table).
      if (child.nodeType !== Node.ELEMENT_NODE || !TABLE_PARTS.has((child as Element).localName))
        continue;
    }
    for (const part of walk(child, context, depth)) created.appendChild(part);
  }
  if (tag === 'table' && created.querySelector('td, th') === null) return [];
  return [created];
}

/** Removes whitespace-only text between the blocks of the paste (Outlook separates every tag with a line break). */
function dropLayoutWhitespace(root: Element): void {
  const isBlock = (n: Node | null): boolean => n === null || isBlockNode(n);
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') {
      if (isBlock(child.previousSibling) || isBlock(child.nextSibling)) child.remove();
    }
  }
}

/** Removes paragraphs that hold nothing (Outlook pads text with empty `<p><o:p></o:p></p>`), and trims the spaces at the edges of blocks. */
function dropEmptyBlocks(root: Element): void {
  for (const paragraph of Array.from(root.querySelectorAll('p'))) {
    if ((paragraph.textContent ?? '').trim().length === 0 && !paragraph.querySelector('br'))
      paragraph.remove();
  }
  for (const block of Array.from(root.querySelectorAll('p, li, td, th'))) {
    const first = block.firstChild;
    if (first?.nodeType === Node.TEXT_NODE)
      first.textContent = (first.textContent ?? '').replace(/^ +/, '');
    const last = block.lastChild;
    if (last?.nodeType === Node.TEXT_NODE)
      last.textContent = (last.textContent ?? '').replace(/ +$/, '');
  }
}
