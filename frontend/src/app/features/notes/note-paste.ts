/**
 * Formatted paste of a note (#1411, epic #1405; design note docs/ux/notes-round-2/README.md section 5).
 *
 * One pure function, `cleanPaste`, turns the `text/html` of a clipboard (Word, Outlook, Google Docs, Excel, a web page, another note) into the small vocabulary the note
 * can hold: paragraphs, headings 1 to 3, bold, italic, underline, bulleted and numbered lists, tables, links and quotes. Colours, fonts, highlight, strikethrough and layout
 * are dropped; hidden text, tracked deletions and pictures inside the text are dropped (and counted so the editor can say so). The work happens in an inert document made by
 * `DOMParser`, never in the live editor, and ProseMirror then parses the result with the note's own schema, so only what the note can hold gets in.
 *
 * This is for quality, not for security: the server sanitiser (`RichHtml`, profile Note) re-checks everything on save and drops hidden text and `del` as well.
 * It adds no editor mark, no toolbar button and no shortcut (#420).
 */

/** The limits of a note body, as the server states them (`RichHtmlLimits.Note`). */
export const PASTE_MAX_CHARS = 400_000;
export const PASTE_MAX_TAGS = 20_000;
export const PASTE_MAX_CELLS = 1_000;
/** Deepest table nesting kept (the server's `MaxTableDepth`); a deeper table becomes paragraphs. */
export const PASTE_MAX_TABLE_DEPTH = 3;
/** A clipboard larger than this is not parsed at all (far over the limits above, cleaning could not bring it under). */
const PARSE_LIMIT_CHARS = 8_000_000;
/** Deepest element nesting walked; deeper content is kept as its text. */
const MAX_DEPTH = 120;

export type PasteProblem = 'too-large' | 'too-many-cells';

export interface PasteResult {
  /** The cleaned html (the note's vocabulary), "" when no text is left. */
  readonly html: string;
  /** The text of the same clipboard, for Paste as Plain Text. */
  readonly plain: string;
  /** True when the cleaned html carries formatting beyond paragraphs and line breaks, so the Paste Options chip is worth showing. */
  readonly formatted: boolean;
  /** Pictures inside the pasted text that were left out. */
  readonly droppedImages: number;
  /** The ids of the note images in the cleaned html (a note's own pictures, copied from another note), in order, without repeats. */
  readonly imageIds: readonly number[];
  /** True when tracked deletions were left out (inserted text is kept). */
  readonly droppedDeletions: boolean;
  /** Table cells in the cleaned html. */
  readonly tableCells: number;
  readonly problem: PasteProblem | null;
}

/** The words of the paste messages (toasts and inline messages; design note 5.2, 5.6 and section 14). One table, sentence case, no full stop in a toast summary (D-52). */
export const PASTE_COPY = {
  imagesSummary: (n: number): string => `Pasted without ${n} ${n === 1 ? 'image' : 'images'}`,
  imagesDetail:
    "Images inside copied text can't be kept. Paste an image on its own, or take a screenshot.",
  deletionsSummary: 'Pasted without tracked deletions',
  deletionsDetail: 'Inserted text was kept.',
  tooLarge: "That's too much to paste at once. Paste it in parts.",
  tooManyCells: (n: number): string =>
    `That table has ${n.toLocaleString('en-US')} cells; a note holds at most ${PASTE_MAX_CELLS.toLocaleString('en-US')}.`,
  chip: 'Pasted with formatting',
  chipLabel: 'Paste options',
  keep: 'Keep Formatting',
  keepHelp: 'Headings, bold, italic, lists, tables and links stay as copied.',
  plain: 'Paste as Plain Text',
  plainHelp: 'Replaces this paste with its text only, no layout.',
  tip: 'In the browser, Ctrl + Shift + V pastes as plain text from the start.',
  live: 'Pasted. Paste options available.',
  livePlain: 'Pasted as plain text.',
} as const;

const NOTE_COLOURS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'slate'];

/** Removed with their content. `xml` is Word's island, `head` and `title` the page's own. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'frame',
  'frameset',
  'applet',
  'textarea',
  'select',
  'option',
  'input',
  'button',
  'title',
  'xml',
  'head',
  'meta',
  'link',
  'base',
  'audio',
  'video',
  'canvas',
  'picture',
  'map',
  'hr',
  'wbr',
]);

/** A block that holds text or other blocks: it becomes one paragraph, or its children are lifted when it holds blocks. */
const BLOCK_WRAPPERS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'address',
  'figure',
  'figcaption',
  'center',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'form',
  'fieldset',
  'legend',
  'hgroup',
  'li',
  'tr',
  'td',
  'th',
  'tbody',
  'thead',
  'tfoot',
  'caption',
  'colgroup',
  'body',
]);

const BLOCK_OUT = new Set([
  'img',
  'p',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
]);

interface Marks {
  readonly strong: boolean;
  readonly em: boolean;
  readonly u: boolean;
  readonly colour: string | null;
}

interface Ctx {
  readonly doc: Document;
  readonly marks: Marks;
  /** Inside a heading, a link or a header cell: bold or underline there is the element's own look, not a mark to add. */
  readonly noBold: boolean;
  readonly noUnderline: boolean;
  /** Inside a heading: blocks are lifted, only inline content is kept. */
  readonly flat: boolean;
  readonly tableDepth: number;
  /** The clipboard came from a ProseMirror editor (another note): its own colour spans are kept. */
  readonly own: boolean;
  readonly depth: number;
  /** Directly inside a `ul` or `ol`: an `li` is an item here, a paragraph anywhere else. */
  readonly inList: boolean;
  readonly stats: { images: number; deletions: boolean; imageIds: number[] };
}

const NO_MARKS: Marks = { strong: false, em: false, u: false, colour: null };

/** The inline style of an element as a map of lower-case property to value. Word writes `mso-list:l0 level1 lfo1;font-family:"Times New Roman"`. */
function styleOf(el: Element): Map<string, string> {
  const out = new Map<string, string>();
  const raw = el.getAttribute('style');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return out;
}

const ZERO = /^0+(\.0+)?[a-z%]*$/i;

/** Text a reader could not see (design note 5.2): the same rule as the server's `HiddenStylePattern`. */
function isHidden(el: Element, style: Map<string, string>): boolean {
  if (el.hasAttribute('hidden')) return true;
  const clean = (v: string | undefined) =>
    (v ?? '')
      .replace(/!\s*important/i, '')
      .trim()
      .toLowerCase();
  return (
    clean(style.get('display')) === 'none' ||
    ['hidden', 'collapse'].includes(clean(style.get('visibility'))) ||
    clean(style.get('mso-hide')) === 'all' ||
    (style.has('font-size') && ZERO.test(clean(style.get('font-size')))) ||
    (style.has('opacity') && ZERO.test(clean(style.get('opacity'))))
  );
}

function isBoldValue(v: string | undefined): boolean {
  return v !== undefined && /^(bold|bolder|[6-9]00)$/i.test(v.trim());
}

/** The Word list paragraph's level, or 0 when it is not one (`mso-list:l0 level2 lfo1`; `mso-list:none` and `Ignore` are not items). */
function wordListLevel(el: Element, style: Map<string, string>): number {
  const v = style.get('mso-list');
  if (!v || /^(none|ignore)\b/i.test(v.trim())) return 0;
  const m = /level(\d+)/i.exec(v);
  return m ? Math.min(Math.max(Number(m[1]), 1), 9) : 1;
}

/** A link target a note may keep: http, https, mailto, `onenote:https:`. Outlook Safe Links are unwrapped to the real address (decided, question 16). */
export function realHref(raw: string | null): string | null {
  if (!raw) return null;
  let href = raw.trim();
  if (
    href.length === 0 ||
    href.length > 2000 ||
    /[<>"`]/.test(href) ||
    Array.from(href).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return null;
  try {
    const u = new URL(href);
    if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(u.hostname)) {
      const target = u.searchParams.get('url');
      if (target) href = target.trim();
    }
  } catch {
    return null;
  }
  if (/^mailto:/i.test(href)) return href;
  if (/^onenote:https:\/\//i.test(href)) return href;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const u = new URL(href);
    // Links with credentials read as another site (the server refuses them too).
    return u.username || u.password ? null : href;
  } catch {
    return null;
  }
}

/** A text node (non-breaking spaces become normal spaces) inside the marks that are on at this point. */
function text(ctx: Ctx, data: string): Node {
  const m = ctx.marks;
  let node: Node = ctx.doc.createTextNode(data.replace(/\u00A0/g, ' '));
  const around = (e: Element): void => {
    e.append(node);
    node = e;
  };
  if (m.colour) {
    const span = ctx.doc.createElement('span');
    span.setAttribute('data-color', m.colour);
    around(span);
  }
  if (m.u) around(ctx.doc.createElement('u'));
  if (m.em) around(ctx.doc.createElement('em'));
  if (m.strong) around(ctx.doc.createElement('strong'));
  return node;
}

function withMarks(ctx: Ctx, el: Element, style: Map<string, string>): Ctx {
  const tag = el.localName;
  const weight = style.get('font-weight');
  // Google Docs wraps the whole copy in `<b style="font-weight:normal">`: that b is not bold.
  const bold =
    !ctx.noBold && (weight !== undefined ? isBoldValue(weight) : tag === 'b' || tag === 'strong');
  const italicStyle = style.get('font-style');
  const italic =
    italicStyle !== undefined
      ? /italic|oblique/i.test(italicStyle)
      : tag === 'i' || tag === 'em' || tag === 'cite';
  const deco = `${style.get('text-decoration') ?? ''} ${style.get('text-decoration-line') ?? ''}`;
  const underline =
    !ctx.noUnderline &&
    tag !== 'a' &&
    (tag === 'u' || /underline/i.test(deco)) &&
    !/line-through/i.test(deco);
  let colour = ctx.marks.colour;
  if (ctx.own && tag === 'span') {
    const c = el.getAttribute('data-color');
    if (c && NOTE_COLOURS.includes(c)) colour = c;
  }
  const marks: Marks = {
    strong: ctx.marks.strong || bold,
    em: ctx.marks.em || italic,
    u: ctx.marks.u || underline,
    colour,
  };
  return marks.strong === ctx.marks.strong &&
    marks.em === ctx.marks.em &&
    marks.u === ctx.marks.u &&
    marks.colour === ctx.marks.colour
    ? ctx
    : { ...ctx, marks };
}

/** True when the nodes hold an element the note treats as a block (so inline runs between them need their own paragraphs). */
function hasBlock(nodes: readonly Node[]): boolean {
  return nodes.some((n) => n.nodeType === 1 && BLOCK_OUT.has((n as Element).localName));
}

/** Loose inline runs between blocks become paragraphs; whitespace-only runs between blocks go. */
function toBlocks(ctx: Ctx, nodes: readonly Node[]): Node[] {
  if (!hasBlock(nodes)) {
    return nodes.length === 0 ? [] : [para(ctx, nodes)];
  }
  const out: Node[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (run.length && run.some((n) => n.nodeType !== 3 || (n.textContent ?? '').trim() !== ''))
      out.push(para(ctx, run));
    run = [];
  };
  for (const n of nodes) {
    if (n.nodeType === 1 && BLOCK_OUT.has((n as Element).localName)) {
      flush();
      out.push(n);
    } else run.push(n);
  }
  flush();
  return out;
}

function para(ctx: Ctx, children: readonly Node[]): Element {
  const p = ctx.doc.createElement('p');
  p.append(...children);
  return p;
}

function convertChildren(ctx: Ctx, parent: Node): Node[] {
  if (ctx.depth > MAX_DEPTH) return parent.textContent ? [text(ctx, parent.textContent)] : [];
  const out: Node[] = [];
  const kids = Array.from(parent.childNodes);
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.nodeType === 3) {
      const data = kid.textContent ?? '';
      if (data) out.push(text(ctx, data));
      continue;
    }
    if (kid.nodeType !== 1) continue; // comments, processing instructions
    const el = kid as Element;
    const st = styleOf(el);
    const level = isHidden(el, st) ? 0 : wordListLevel(el, st);
    if (level > 0 && !ctx.flat) {
      // A run of Word list paragraphs becomes one real list with its levels.
      const run: Element[] = [el];
      let j = i + 1;
      for (; j < kids.length; j++) {
        const k = kids[j];
        // Whitespace and comments (Word writes conditional comments between paragraphs) do not end the list.
        if (k.nodeType === 8 || (k.nodeType === 3 && (k.textContent ?? '').trim() === '')) continue;
        const ks = k.nodeType === 1 ? styleOf(k as Element) : null;
        if (ks && isHidden(k as Element, ks)) continue;
        if (ks && wordListLevel(k as Element, ks) > 0) run.push(k as Element);
        else break;
      }
      i = j - 1;
      out.push(...buildWordList(ctx, run));
      continue;
    }
    out.push(...convertElement(ctx, el));
  }
  return out;
}

/** Rebuilds Word's list paragraphs (`mso-list` levels, the typed bullet or number in a `mso-list:Ignore` span) as nested `ul` and `ol`. */
function buildWordList(ctx: Ctx, items: readonly Element[]): Node[] {
  const roots: Node[] = [];
  const stack: { level: number; list: Element; ordered: boolean; li: Element | null }[] = [];
  for (const item of items) {
    const level = wordListLevel(item, styleOf(item));
    let marker = '';
    const clone = item.cloneNode(true) as Element;
    for (const span of Array.from(clone.querySelectorAll('[style]'))) {
      if (/mso-list\s*:\s*ignore/i.test(span.getAttribute('style') ?? '')) {
        marker += span.textContent ?? '';
        span.remove();
      }
    }
    const ordered = /^[(]?([0-9]+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]$/.test(
      marker.replace(/[\s\u00A0]/g, ''),
    );
    while (
      stack.length &&
      (stack[stack.length - 1].level > level ||
        (stack[stack.length - 1].level === level && stack[stack.length - 1].ordered !== ordered))
    )
      stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < level) {
      const list = ctx.doc.createElement(ordered ? 'ol' : 'ul');
      if (top) {
        // A deeper item sits inside the previous item of the level above.
        const host = top.li ?? ctx.doc.createElement('li');
        if (!top.li) {
          top.list.append(host);
          top.li = host;
        }
        host.append(list);
      } else roots.push(list);
      top = { level, list, ordered, li: null };
      stack.push(top);
    }
    const li = ctx.doc.createElement('li');
    const inner = convertChildren({ ...ctx, depth: ctx.depth + 1, flat: true }, clone);
    li.append(...toBlocks(ctx, inner));
    top.list.append(li);
    top.li = li;
  }
  return roots;
}

/** A picture that is one of the app's note images: a positive `data-image-id` and no address. The alt text and the size are carried over (the server checks them again). */
function ownImage(el: Element): { id: number; node: (doc: Document) => Element } | null {
  if (el.hasAttribute('src') || el.hasAttribute('srcset')) return null;
  const raw = el.getAttribute('data-image-id') ?? '';
  if (!/^\d{1,10}$/.test(raw) || Number(raw) < 1) return null;
  const id = Number(raw);
  const dim = (name: string): string | null => {
    const v = el.getAttribute(name)?.trim() ?? '';
    return /^\d{1,4}$/.test(v) && Number(v) >= 1 ? v : null;
  };
  const width = dim('width');
  const height = dim('height');
  const alt = (el.getAttribute('alt') ?? '').slice(0, 200);
  return {
    id,
    node: (doc) => {
      const img = doc.createElement('img');
      img.setAttribute('data-image-id', String(id));
      img.setAttribute('alt', alt);
      if (width && height) {
        img.setAttribute('width', width);
        img.setAttribute('height', height);
      }
      return img;
    },
  };
}

function convertElement(ctx: Ctx, el: Element): Node[] {
  const tag = el.localName;
  const style = styleOf(el);
  if (isHidden(el, style)) return [];
  if (tag === 'del') {
    ctx.stats.deletions = true;
    return [];
  }
  if (tag === 'img') {
    // A picture of the app's own notes (`<img data-image-id>`, no address: copied from a note) is kept as a block; the editor copies it into this matter when it
    // belongs to another one. Any other picture (Word, Outlook, a web page) cannot be kept in this round and is counted for the toast (design note 5.3).
    const own = ownImage(el);
    if (own) {
      ctx.stats.imageIds.push(own.id);
      return [own.node(ctx.doc)];
    }
    ctx.stats.images += 1;
    return [];
  }
  if (DROP_WITH_CONTENT.has(tag)) return [];
  // Word's and Office's namespaces: `<o:p>` is an empty marker, `<v:shape>` a drawing; smart tags (`<st1:place>`) keep their text.
  if (tag.includes(':'))
    return /^(o|v|w|m|x):/.test(tag) ? [] : convertChildren({ ...ctx, depth: ctx.depth + 1 }, el);

  const next = { ...ctx, depth: ctx.depth + 1 };

  if (tag === 'br') return [ctx.doc.createElement('br')];

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(Number(tag[1]), 3);
    return [heading(next, el, level)];
  }
  if (tag === 'p' && /\bMsoTitle\b/.test(el.getAttribute('class') ?? ''))
    return [heading(next, el, 1)];

  if (tag === 'pre') {
    const lines = (el.textContent ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/^\n+|\n+$/g, '')
      .split('\n');
    return lines.map((line) => para(ctx, line ? [text(ctx, line.replace(/\t/g, '    '))] : []));
  }

  if (tag === 'blockquote') {
    const blockquote = ctx.doc.createElement('blockquote');
    blockquote.append(...toBlocks(ctx, convertChildren({ ...next, flat: false }, el)));
    return blockquote.textContent?.trim() ? [blockquote] : [];
  }

  if (tag === 'ul' || tag === 'ol')
    return ctx.flat ? convertChildren(next, el) : [list(next, el, tag)];

  if (tag === 'table') return ctx.flat ? convertChildren(next, el) : table(next, el);

  if (tag === 'a') {
    const raw = el.getAttribute('href');
    const href = realHref(raw);
    const inner = withMarks({ ...next, noUnderline: true }, el, style);
    if (!href) return convertChildren(inner, el);
    let kids = convertChildren(inner, el);
    // Outlook shows the wrapped address as the link text too: show the real address.
    if (raw && href !== raw.trim() && (el.textContent ?? '').trim() === raw.trim())
      kids = [text(inner, href)];
    if (kids.length === 0) return [];
    const a = ctx.doc.createElement('a');
    a.setAttribute('href', href);
    a.append(...kids);
    return [a];
  }

  if (BLOCK_WRAPPERS.has(tag)) {
    if (ctx.flat) return convertChildren(next, el);
    const marked = withMarks({ ...next, inList: false }, el, style);
    const kids = convertChildren(marked, el);
    if (tag === 'li' && ctx.inList) return [li(ctx, kids)];
    if (kids.length === 0) return tag === 'p' || tag === 'div' ? [ctx.doc.createElement('p')] : [];
    return hasBlock(kids) ? toBlocks(ctx, kids) : [para(ctx, kids)];
  }

  // Everything else is inline: span, font, b, i, u, ins, s, strike, sub, sup, mark, code, small ... Its marks are read, its tag is not kept.
  return convertChildren(withMarks(next, el, style), el);
}

function li(ctx: Ctx, kids: readonly Node[]): Element {
  const item = ctx.doc.createElement('li');
  item.append(...toBlocks(ctx, kids));
  return item;
}

function heading(ctx: Ctx, el: Element, level: number): Element {
  const h = ctx.doc.createElement(`h${level}`);
  const kids = convertChildren(
    withMarks({ ...ctx, noBold: true, flat: true }, el, styleOf(el)),
    el,
  );
  h.append(...kids);
  return h;
}

function list(ctx: Ctx, el: Element, tag: 'ul' | 'ol'): Element {
  const out = ctx.doc.createElement(tag);
  const kids = convertChildren(withMarks({ ...ctx, inList: true }, el, styleOf(el)), el);
  let last: Element | null = null;
  let loose: Node[] = [];
  const flushLoose = () => {
    if (loose.some((n) => n.nodeType !== 3 || (n.textContent ?? '').trim() !== '')) {
      last = li(ctx, loose);
      out.append(last);
    }
    loose = [];
  };
  for (const k of kids) {
    if (k.nodeType === 1 && (k as Element).localName === 'li') {
      flushLoose();
      last = k as Element;
      out.append(k);
    } else if (
      k.nodeType === 1 &&
      ((k as Element).localName === 'ul' || (k as Element).localName === 'ol')
    ) {
      // Google Docs puts a nested list directly inside the list: it belongs to the item before it.
      flushLoose();
      if (!last) {
        last = ctx.doc.createElement('li');
        out.append(last);
      }
      last.append(k);
    } else loose.push(k);
  }
  flushLoose();
  return out;
}

/** True when the element or one of its ancestors below `stop` is hidden (a hidden `tbody` hides its rows). */
function hiddenWithin(el: Element, stop: Element): boolean {
  for (let e: Element | null = el; e && e !== stop; e = e.parentElement) {
    if (isHidden(e, styleOf(e))) return true;
  }
  return false;
}

function table(ctx: Ctx, el: Element): Node[] {
  const depth = ctx.tableDepth + 1;
  const inner = { ...ctx, tableDepth: depth, inList: false };
  if (depth > PASTE_MAX_TABLE_DEPTH) {
    // Deeper than the server keeps: cells become paragraphs.
    const out: Node[] = [];
    for (const cell of Array.from(el.querySelectorAll('td, th'))) {
      if (cell.closest('table') !== el) continue;
      out.push(...toBlocks(ctx, convertChildren({ ...inner, flat: true }, cell)));
    }
    return out;
  }
  const before: Node[] = [];
  const t = ctx.doc.createElement('table');
  const body = ctx.doc.createElement('tbody');
  const rows = Array.from(el.querySelectorAll('tr')).filter((r) => r.closest('table') === el);
  for (const row of rows) {
    if (hiddenWithin(row, el)) continue;
    const inHead = row.parentElement?.localName === 'thead';
    const tr = ctx.doc.createElement('tr');
    for (const cell of Array.from(row.children)) {
      const name = cell.localName;
      if (name !== 'td' && name !== 'th') continue;
      const cs = styleOf(cell);
      if (isHidden(cell, cs)) continue;
      const out = ctx.doc.createElement(name === 'th' || inHead ? 'th' : 'td');
      for (const attr of ['colspan', 'rowspan']) {
        const v = cell.getAttribute(attr)?.trim() ?? '';
        if (/^\d{1,3}$/.test(v) && Number(v) > 1 && Number(v) <= 100) out.setAttribute(attr, v);
      }
      const ctxCell: Ctx = { ...inner, noBold: ctx.noBold || name === 'th' || inHead };
      const kids = convertChildren(withMarks(ctxCell, cell, cs), cell);
      const blocks = toBlocks(ctx, kids);
      out.append(...(blocks.length ? blocks : [ctx.doc.createElement('p')]));
      tr.append(out);
    }
    if (tr.childElementCount) body.append(tr);
  }
  for (const cap of Array.from(el.children).filter((c) => c.localName === 'caption')) {
    const kids = convertChildren({ ...inner, flat: true }, cap);
    if (kids.length) before.push(para(ctx, kids));
  }
  if (!body.childElementCount) return before;
  t.append(body);
  return [...before, t];
}

/** Empty paragraphs (Word's `&nbsp;` lines): leading and trailing ones go, a run of them becomes one. */
function collapseEmpty(parent: Element): void {
  const isEmpty = (n: Element) =>
    n.localName === 'p' &&
    (n.textContent ?? '').trim() === '' &&
    !n.querySelector('table, ul, ol, img');
  let prevEmpty = true; // a leading empty paragraph is dropped like a repeat
  for (const child of Array.from(parent.children)) {
    if (!isEmpty(child)) {
      prevEmpty = false;
      continue;
    }
    if (prevEmpty) child.remove();
    else prevEmpty = true;
  }
  const last = parent.lastElementChild;
  if (last && isEmpty(last)) last.remove();
}

/**
 * Windows clipboards mark the copied part with `<!--StartFragment-->` and `<!--EndFragment-->`; only that part is read. The markers can sit inside a table (Excel writes
 * `<table><!--StartFragment--><tr>...`), so the page is parsed whole and everything before and after the markers is removed, keeping the elements around them.
 */
function trimToFragment(doc: Document): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  let start: Node | null = null;
  let end: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue === 'StartFragment' && !start) start = n;
    else if (n.nodeValue === 'EndFragment') end = n;
  }
  if (!start || !end || !(start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING))
    return;
  for (let n: Node | null = start; n && n !== doc.body; n = n.parentNode) {
    while (n.previousSibling) n.previousSibling.remove();
  }
  for (let n: Node | null = end; n && n !== doc.body; n = n.parentNode) {
    while (n.nextSibling) n.nextSibling.remove();
  }
}

/** The plain version of a clipboard that has no `text/plain`: the text of the cleaned html, one line per block. */
function plainOf(root: Element): string {
  const lines: string[] = [];
  for (const b of Array.from(root.querySelectorAll('p, h1, h2, h3, li, td, th'))) {
    if (b.querySelector('p, li, td, th')) continue;
    lines.push((b.textContent ?? '').trim());
  }
  return lines.join('\n');
}

const EMPTY: PasteResult = {
  html: '',
  plain: '',
  formatted: false,
  droppedImages: 0,
  imageIds: [],
  droppedDeletions: false,
  tableCells: 0,
  problem: null,
};

/**
 * Cleans the clipboard of one paste. `html` is the `text/html` flavour (null or empty when there is none), `plain` the `text/plain` one.
 * Never throws for odd markup; the caller falls back to the plain path if it ever does.
 */
export function cleanPaste(
  html: string | null | undefined,
  plain: string | null | undefined,
): PasteResult {
  const plainText = (plain ?? '').replace(/\r\n?/g, '\n');
  if (!html || html.trim() === '') return { ...EMPTY, plain: plainText };
  if (html.length > PARSE_LIMIT_CHARS) return { ...EMPTY, plain: plainText, problem: 'too-large' };

  const source = new DOMParser().parseFromString(html, 'text/html');
  trimToFragment(source);
  const doc = document.implementation.createHTMLDocument('');
  const ctx: Ctx = {
    doc,
    marks: NO_MARKS,
    noBold: false,
    noUnderline: false,
    flat: false,
    tableDepth: 0,
    own: /data-pm-slice/.test(html),
    depth: 0,
    inList: false,
    stats: { images: 0, deletions: false, imageIds: [] },
  };
  const out = doc.createElement('div');
  out.append(...toBlocks(ctx, convertChildren(ctx, source.body)));
  collapseEmpty(out);

  const droppedImages = ctx.stats.images;
  const droppedDeletions = ctx.stats.deletions;
  const imageIds = [...new Set(ctx.stats.imageIds)];
  const visible =
    (out.textContent ?? '').trim() !== '' ||
    out.querySelector('table') !== null ||
    imageIds.length > 0;
  const base = { droppedImages, droppedDeletions, imageIds };
  if (!visible) return { ...EMPTY, ...base, plain: plainText };

  const tableCells = out.querySelectorAll('td, th').length;
  const cleaned = out.innerHTML;
  const resultPlain = plainText || plainOf(out);
  if (cleaned.length > PASTE_MAX_CHARS || out.querySelectorAll('*').length > PASTE_MAX_TAGS) {
    return { ...EMPTY, ...base, plain: resultPlain, tableCells, problem: 'too-large' };
  }
  if (tableCells > PASTE_MAX_CELLS) {
    return { ...EMPTY, ...base, plain: resultPlain, tableCells, problem: 'too-many-cells' };
  }
  return {
    html: cleaned,
    plain: resultPlain,
    formatted:
      out.querySelector('strong, em, u, h1, h2, h3, ul, ol, table, a, blockquote, span') !== null,
    droppedImages,
    imageIds,
    droppedDeletions,
    tableCells,
    problem: null,
  };
}
