import { PASTE_COPY, cleanPaste, realHref } from './note-paste';
import {
  EXCEL_365,
  GOOGLE_DOCS,
  OTHER_NOTE,
  OUTLOOK_CLASSIC,
  OUTLOOK_WEB,
  WEB_PAGE,
  WORD_365,
  WORD_REDLINE,
  bigTable,
} from './note-paste.fixtures';

/** The cleaned html as a tree, for assertions that do not depend on attribute order or whitespace. */
function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

const tags = (root: Element) => Array.from(root.querySelectorAll('*')).map((e) => e.localName);
const texts = (root: Element, sel: string) =>
  Array.from(root.querySelectorAll(sel)).map((e) => (e.textContent ?? '').trim());

/** What the note can hold, and nothing else (design note 5.2). */
const VOCABULARY = new Set([
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'strong',
  'em',
  'u',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'span',
]);

function expectOnlyNoteVocabulary(root: Element): void {
  for (const e of Array.from(root.querySelectorAll('*'))) {
    expect(VOCABULARY.has(e.localName), `<${e.localName}> is not in the note's vocabulary`).toBe(
      true,
    );
    for (const a of Array.from(e.attributes)) {
      const ok =
        (e.localName === 'a' && a.name === 'href') ||
        (['td', 'th'].includes(e.localName) && ['colspan', 'rowspan'].includes(a.name)) ||
        (e.localName === 'span' && a.name === 'data-color');
      expect(ok, `${e.localName}[${a.name}] is not kept`).toBe(true);
    }
  }
}

describe('cleanPaste: Word 365', () => {
  const r = cleanPaste(WORD_365, 'Custodian Collection Plan\n...');
  const root = dom(r.html);

  it('keeps heading, bold, italic, the list with its second level, the table and the link', () => {
    expect(r.formatted).toBe(true);
    expect(texts(root, 'h1')).toEqual(['Custodian Collection Plan']);
    expect(texts(root, 'strong')).toContain('Status as of Monday.');
    expect(texts(root, 'em')).toEqual(['complete']);
    expect(root.querySelectorAll('ul > li').length).toBe(3);
    expect(texts(root, 'ul > li > ul > li')).toEqual(['Slack: 90 days']);
    expect(root.querySelectorAll('table tr').length).toBe(2);
    expect(texts(root, 'table tr:first-child td')).toEqual(['Custodian', 'Source', 'Status']);
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://tracker.example.com/plan');
  });

  it('drops colour, highlight, strikethrough, fonts and layout but keeps the words', () => {
    expect(root.querySelector('span')).toBeNull();
    expect(root.querySelector('s, strike, font')).toBeNull();
    expect(root.textContent).toContain('the iPhone for M. Chen is late');
    expect(root.textContent).toContain('the Slack export is done');
    expect(root.textContent).toContain('needs a recheck');
    expect(r.html).not.toMatch(/style=|class=|mso-|color|Calibri/i);
    expectOnlyNoteVocabulary(root);
  });

  it('rebuilds the typed bullets as real lists (no bullet characters left in the text)', () => {
    expect(root.textContent).not.toContain('·');
    expect(texts(root, 'li > p, li').join('|')).not.toMatch(/^\s*o\s/);
  });

  it('collapses the &nbsp; lines and leaves no empty paragraph at the start or end', () => {
    const ps = Array.from(root.children);
    expect(ps[0].localName).toBe('h1');
    expect(ps[ps.length - 1].textContent?.trim()).not.toBe('');
    const empty = (e: Element) => e.localName === 'p' && !e.textContent?.trim();
    expect(ps.some((e, i) => i > 0 && empty(e) && empty(ps[i - 1]))).toBe(false);
    expect(ps.filter(empty).length).toBe(2); // the two &nbsp; lines before "Next steps" became one; the one after the table stays
    expect(r.html).not.toContain('\u00A0');
  });

  it('reports nothing dropped that the person would need to hear about', () => {
    expect(r.droppedImages).toBe(0);
    expect(r.droppedDeletions).toBe(false);
    expect(r.problem).toBeNull();
  });
});

describe('cleanPaste: tracked changes and pictures in Word text', () => {
  const r = cleanPaste(WORD_REDLINE, 'The parties agree to thirty sixty days notice.');
  const root = dom(r.html);

  it('keeps inserted text, drops deleted text, and says so', () => {
    expect(root.textContent).toContain('sixty');
    expect(root.textContent).not.toContain('thirty');
    expect(root.textContent).toContain('The parties agree to sixty days notice.');
    expect(r.droppedDeletions).toBe(true);
  });

  it('drops the pictures (file: and cid: addresses) and counts them', () => {
    expect(r.droppedImages).toBe(2);
    expect(root.querySelector('img')).toBeNull();
    expect(r.html).not.toMatch(/file:|cid:/);
  });

  it('words the messages from the shared table', () => {
    expect(PASTE_COPY.imagesSummary(2)).toBe('Pasted without 2 images');
    expect(PASTE_COPY.imagesSummary(1)).toBe('Pasted without 1 image');
    expect(PASTE_COPY.deletionsSummary).toBe('Pasted without tracked deletions');
  });
});

describe('cleanPaste: Outlook classic', () => {
  const r = cleanPaste(OUTLOOK_CLASSIC, '');
  const root = dom(r.html);

  it('unwraps the Safe Link to the real address, in the link and in its text', () => {
    const link = root.querySelector('a[href^="https://docs.example.com"]');
    expect(link?.getAttribute('href')).toBe('https://docs.example.com/plan?v=3&x=1');
    expect(link?.textContent).toBe('https://docs.example.com/plan?v=3&x=1');
    expect(r.html).not.toContain('safelinks');
    expect(r.html).not.toContain('reserved');
  });

  it('keeps mailto, drops javascript, file and relative links but keeps their text', () => {
    expect(root.querySelector('a[href^="mailto:"]')?.textContent).toBe('ediscovery@firm.example');
    expect(r.html).not.toMatch(/href="(javascript|file:|\/relative)/);
    expect(r.html).not.toContain('javascript:');
    expect(root.textContent).toContain('Click me');
    expect(root.textContent).toContain('the file');
    expect(root.textContent).toContain('a relative one');
    expect(root.querySelectorAll('a').length).toBe(2);
  });

  it('drops the hidden pre-header', () => {
    expect(root.textContent).not.toContain('Preheader');
  });

  it('rebuilds the numbered list', () => {
    expect(texts(root, 'ol > li')).toEqual(['Collect the laptops', 'Image them']);
    expect(root.textContent).not.toMatch(/\b1\.\s/);
  });
});

describe('cleanPaste: Outlook on the web and new Outlook', () => {
  const r = cleanPaste(OUTLOOK_WEB, 'Thanks for the update.');
  const root = dom(r.html);

  it('turns the divs into paragraphs, keeps bold, the list and the quote', () => {
    expect(root.children[0].localName).toBe('p');
    expect(root.children[0].textContent).toBe('Thanks for the update.');
    expect(texts(root, 'strong')).toEqual(['Open items']);
    expect(texts(root, 'ul > li')).toEqual(['Tablet imaging', 'Slack export']);
    expect(texts(root, 'blockquote > p')).toEqual([
      'On Mon, R. Alvarez wrote:',
      'The iPhone is late.',
    ]);
  });

  it('drops hidden text and every style', () => {
    expect(root.textContent).not.toContain('hidden tracking');
    expectOnlyNoteVocabulary(root);
  });
});

describe('cleanPaste: Google Docs', () => {
  const r = cleanPaste(GOOGLE_DOCS, 'Findings\n...');
  const root = dom(r.html);

  it('does not treat the font-weight:normal wrapper as bold, and keeps heading level 2', () => {
    expect(texts(root, 'h2')).toEqual(['Findings']);
    expect(texts(root, 'strong')).toEqual(['Bold']);
    expect(root.querySelector('h2 strong')).toBeNull();
    expect(r.html).not.toContain('docs-internal-guid');
  });

  it('keeps italic and underline, drops strikethrough, and does not underline a link twice', () => {
    expect(texts(root, 'em')).toEqual(['italic']);
    expect(texts(root, 'u')).toEqual(['underlined']);
    expect(root.textContent).toContain('struck');
    expect(root.querySelector('a u')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/ref');
  });

  it('moves the nested list into its parent item', () => {
    expect(root.querySelectorAll('ul > ul').length).toBe(0);
    expect(texts(root, 'ul > li > ul > li')).toEqual(['Nested']);
    expect(root.querySelectorAll('ul > li').length).toBe(3);
  });
});

describe('cleanPaste: Excel 365', () => {
  const r = cleanPaste(EXCEL_365, 'Custodian\tSource\tSize (GB)\nR. Alvarez\tLaptop\t1,234.50\n');
  const root = dom(r.html);

  it('keeps the table and drops hidden columns and rows', () => {
    expect(root.querySelectorAll('tr').length).toBe(3);
    expect(texts(root, 'tr:first-child td')).toEqual(['Custodian', 'Source', 'Size (GB)']);
    expect(r.html).not.toMatch(/SSN-HIDDEN|111-22-3333|444-55-6666|Hidden row/);
  });

  it('keeps numbers as typed and the first row a normal row', () => {
    expect(texts(root, 'tr:nth-child(2) td')).toEqual(['R. Alvarez', 'Laptop', '1,234.50']);
    expect(root.querySelector('th')).toBeNull();
    expect(r.tableCells).toBe(9);
    expectOnlyNoteVocabulary(root);
  });
});

describe('cleanPaste: a web page', () => {
  const r = cleanPaste(WEB_PAGE, '');
  const root = dom(r.html);

  it('keeps the heading (3), bold from weight 600, italic and the link with its real query', () => {
    expect(texts(root, 'h3')).toEqual(['Retention periods']);
    expect(texts(root, 'strong')).toEqual(['90 days']);
    expect(texts(root, 'em')).toEqual(['free plan']);
    expect(root.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/retention?a=1&b=2',
    );
  });

  it('drops the remote image (counted), the script, the form fields and the styles; code and sup keep their text', () => {
    expect(r.droppedImages).toBe(1);
    expect(r.html).not.toMatch(/img|script|alert|input|typed|Go<|style=|class=/);
    expect(root.textContent).toContain('retention.json');
    expect(root.textContent).toContain('Last paragraph1');
    expectOnlyNoteVocabulary(root);
  });
});

describe('cleanPaste: another note', () => {
  it('keeps the note colour and turns a reference chip into its text', () => {
    const r = cleanPaste(OTHER_NOTE, '');
    const root = dom(r.html);
    expect(root.querySelector('span[data-color="red"]')?.textContent).toBe('in red');
    expect(r.html).not.toContain('data-asset-id');
    expect(r.html).not.toContain('data-pm-slice');
    expect(root.textContent).toContain('#Slack export');
    expect(texts(root, 'li')).toEqual(['Item']);
  });

  it('drops a colour that comes from anywhere else, even a valid key', () => {
    const r = cleanPaste(
      '<p>a <span data-color="red">b</span> <span style="color:red">c</span></p>',
      '',
    );
    expect(r.html).not.toMatch(/data-color|color/);
  });
});

describe('cleanPaste: plain text and odd clipboards', () => {
  it('a text-only clipboard (also Ctrl+Shift+V) has no html, so the editor takes the plain path', () => {
    const r = cleanPaste('', 'line one\nline two');
    expect(r.html).toBe('');
    expect(r.plain).toBe('line one\nline two');
    expect(r.formatted).toBe(false);
    expect(cleanPaste(null, 'x').html).toBe('');
    expect(cleanPaste(undefined, undefined).plain).toBe('');
  });

  it('html with only paragraphs is not "formatted", so no chip is offered', () => {
    const r = cleanPaste('<div>One</div><div>Two</div>', 'One\nTwo');
    expect(r.formatted).toBe(false);
    expect(dom(r.html).querySelectorAll('p').length).toBe(2);
  });

  it('a picture on its own leaves nothing to paste and counts the picture', () => {
    const r = cleanPaste('<meta charset="utf-8"><img src="https://example.com/a.png" alt="x">', '');
    expect(r.html).toBe('');
    expect(r.droppedImages).toBe(1);
  });

  it('hidden text (hidden attribute, display none, zero size, opacity 0) is dropped', () => {
    const r = cleanPaste(
      '<p>Seen</p><p hidden>H1</p><p style="display: none !important">H2</p><p><span style="font-size:0">H3</span><span style="opacity:0">H4</span><span style="mso-hide:all">H5</span>kept</p>',
      '',
    );
    expect(r.html).toContain('Seen');
    expect(r.html).toContain('kept');
    expect(r.html).not.toMatch(/H[1-5]/);
  });

  it('keeps a quote and heading levels 4 to 6 as heading 3, a Word title as heading 1', () => {
    const r = cleanPaste(
      '<h4>Four</h4><h6>Six</h6><p class="MsoTitle">Title</p><blockquote>Said</blockquote>',
      '',
    );
    const root = dom(r.html);
    expect(texts(root, 'h3')).toEqual(['Four', 'Six']);
    expect(texts(root, 'h1')).toEqual(['Title']);
    expect(texts(root, 'blockquote')).toEqual(['Said']);
  });

  it('turns preformatted text into paragraphs and drops the horizontal rule', () => {
    const r = cleanPaste('<pre>a\n  b</pre><hr><p>c</p>', '');
    expect(r.html).not.toMatch(/pre|hr/);
    expect(dom(r.html).querySelectorAll('p').length).toBe(3);
  });

  it('keeps merged cells (colspan, rowspan up to 100) and a header row; drops widths', () => {
    const r = cleanPaste(
      '<table width=400><thead><tr><td colspan="2" style="width:50%">H</td></tr></thead><tr><td rowspan="2">a</td><td colspan="101">b</td></tr><tr><td>c</td></tr></table>',
      '',
    );
    const root = dom(r.html);
    expect(root.querySelector('th')?.getAttribute('colspan')).toBe('2');
    expect(root.querySelector('td[rowspan="2"]')).not.toBeNull();
    expect(root.querySelector('td[colspan="101"]')).toBeNull();
    expect(r.html).not.toMatch(/width|style/);
  });

  it('flattens a table nested deeper than 3 into paragraphs', () => {
    const t = (inner: string) => `<table><tr><td>${inner}</td></tr></table>`;
    const r = cleanPaste(t(t(t(t('deep')))), '');
    const root = dom(r.html);
    expect(root.querySelectorAll('table').length).toBe(3);
    expect(root.textContent).toContain('deep');
  });

  it('unknown and namespaced tags keep their text; scripts, styles and XML islands do not', () => {
    const r = cleanPaste(
      '<p><st1:place w:st="on">Paris</st1:place> <x-chip>chip</x-chip><o:p>junk</o:p><xml>islands</xml><style>p{}</style></p>',
      '',
    );
    expect(r.html).toContain('Paris');
    expect(r.html).toContain('chip');
    expect(r.html).not.toMatch(/junk|islands|p\{/);
  });

  it('reads only the copied part of a Windows clipboard (between the fragment markers)', () => {
    const r = cleanPaste(
      '<html><body><p>Before</p><!--StartFragment--><p>Inside</p><!--EndFragment--><p>After</p></body></html>',
      '',
    );
    expect(r.html).toBe('<p>Inside</p>');
  });

  it('survives very deep nesting without throwing', () => {
    const r = cleanPaste('<div>'.repeat(5000) + 'x' + '</div>'.repeat(5000), '');
    expect(typeof r.html).toBe('string');
  });
});

describe('cleanPaste: limits', () => {
  it('refuses more than 1,000 cells with the count in the message', () => {
    const r = cleanPaste(bigTable(1240), '');
    expect(r.problem).toBe('too-many-cells');
    expect(r.html).toBe('');
    expect(r.tableCells).toBe(1240);
    expect(PASTE_COPY.tooManyCells(r.tableCells)).toBe(
      'That table has 1,240 cells; a note holds at most 1,000.',
    );
  });

  it('accepts exactly 1,000 cells', () => {
    expect(cleanPaste(bigTable(1000), '').problem).toBeNull();
  });

  it('refuses a paste that is still over 400,000 characters after the clean-up', () => {
    const r = cleanPaste(`<p>${'word '.repeat(90_000)}</p>`, '');
    expect(r.problem).toBe('too-large');
    expect(PASTE_COPY.tooLarge).toBe("That's too much to paste at once. Paste it in parts.");
  });

  it('cleans first: markup that is large only because of styles is fine', () => {
    const styled =
      '<p style="margin:0;font-family:Calibri,sans-serif;font-size:11pt;color:#222222">row text</p>'.repeat(
        3500,
      );
    const r = cleanPaste(styled, '');
    expect(styled.length).toBeGreaterThan(300_000);
    expect(r.problem).toBeNull();
  });
});

describe('realHref', () => {
  it('unwraps Safe Links of every region and keeps the other kinds of link', () => {
    expect(
      realHref(
        'https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2Fa&data=x',
      ),
    ).toBe('https://example.org/a');
    expect(
      realHref('https://safelinks.protection.outlook.com/?url=http%3A%2F%2Fexample.org%2Fb'),
    ).toBe('http://example.org/b');
    expect(realHref('mailto:a@b.example')).toBe('mailto:a@b.example');
    expect(realHref('onenote:https://example.org/n#x')).toBe('onenote:https://example.org/n#x');
  });

  it('refuses scripts, files, relative links, credentials and a Safe Link to a script', () => {
    for (const bad of [
      'javascript:alert(1)',
      'file:///C:/a.docx',
      '/relative',
      '#anchor',
      'https://user:pw@example.org/',
      'https://good.example@evil.example.org/',
      'data:text/html,x',
      'https://eur02.safelinks.protection.outlook.com/?url=javascript%3Aalert(1)',
      '',
      null,
    ]) {
      expect(realHref(bad), String(bad)).toBeNull();
    }
  });

  it('is never fooled into a different host by the wrapper text', () => {
    expect(
      tags(dom(cleanPaste('<a href="https://example.com@evil.test/">x</a>', '').html)),
    ).not.toContain('a');
  });
});

describe('the fixtures', () => {
  it('are hand-written samples with no real client data', () => {
    for (const sample of [
      WORD_365,
      WORD_REDLINE,
      OUTLOOK_CLASSIC,
      OUTLOOK_WEB,
      GOOGLE_DOCS,
      EXCEL_365,
      WEB_PAGE,
      OTHER_NOTE,
    ]) {
      expect(sample.length).toBeGreaterThan(100);
      expect(sample).not.toMatch(/@(?!firm\.example|b\.example)[a-z0-9-]+\.(com|org|net)\b/i);
    }
    expect(bigTable(25).match(/<td>/g)?.length).toBe(25);
  });
});
