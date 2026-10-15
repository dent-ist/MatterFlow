import {
  LINK_WARNING_BIDI,
  LINK_WARNING_CREDENTIALS,
  cellAtSelection,
  decorateLinks,
  descriptionToHtml,
  htmlToPlainText,
  htmlToText,
  isBlankHtml,
  neighbourCell,
  normalizeLink,
  placeCaret,
  textToHtml,
} from './rich-text';

describe('rich text helpers', () => {
  describe('normalizeLink', () => {
    it.each([
      ['https://example.com/doc?a=1', 'https://example.com/doc?a=1'],
      ['http://example.com', 'http://example.com'],
      ['HTTPS://Example.com', 'HTTPS://Example.com'],
      ['mailto:pat@example.com', 'mailto:pat@example.com'],
      ['  example.com/path  ', 'https://example.com/path'],
      ['www.example.org', 'https://www.example.org'],
    ])('accepts %s', (input, expected) => {
      expect(normalizeLink(input)).toBe(expected);
    });

    it.each([
      '',
      '   ',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,AAAA',
      'vbscript:x',
      'ftp://example.com',
      'file:///etc/passwd',
      '//evil.example.com',
      '/relative/path',
      'not a link',
      'https://exa mple.com',
      'https://',
      'mailto:nobody',
      'localhost',
    ])('rejects %j', (input) => {
      expect(normalizeLink(input)).toBeNull();
    });

    it('rejects absurdly long input and null', () => {
      expect(normalizeLink('https://example.com/' + 'a'.repeat(2000))).toBeNull();
      expect(normalizeLink(null)).toBeNull();
      expect(normalizeLink(undefined)).toBeNull();
    });
  });

  describe('htmlToText / isBlankHtml', () => {
    it('reads the visible text without running anything', () => {
      expect(htmlToText('<p>a <strong>b</strong></p><ul><li>c</li></ul>')).toBe('a bc');
      expect(htmlToText('<img src=x onerror="window.__pwned = true">hi')).toBe('hi');
      expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
      expect(htmlToText(null)).toBe('');
    });

    it('treats empty paragraphs and line breaks as blank', () => {
      expect(isBlankHtml('')).toBe(true);
      expect(isBlankHtml('<p><br></p>')).toBe(true);
      expect(isBlankHtml(' <p>  </p> ')).toBe(true);
      expect(isBlankHtml('<p>x</p>')).toBe(false);
    });
  });

  describe('decorateLinks (SEC2-12)', () => {
    it('opens http(s) links in a new tab and shows the host they go to, with a port when there is one', () => {
      const out = decorateLinks(
        '<p><a href="https://example.com/x">x</a> <a href="http://intranet:8080/y">y</a></p>',
      );
      const doc = new DOMParser().parseFromString(out, 'text/html');
      const anchors = Array.from(doc.querySelectorAll('a'));
      expect(anchors.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank']);
      expect(Array.from(doc.querySelectorAll('.tc__host')).map((e) => e.textContent)).toEqual([
        '(example.com)',
        '(intranet:8080)',
      ]);
      expect(doc.querySelector('.tc__warn')).toBeNull();
    });

    it('shows an internationalized host in its punycode form so look-alike letters are visible', () => {
      const out = decorateLinks('<a href="https://\u0430pple.com/">apple.com</a>');
      expect(
        new DOMParser().parseFromString(out, 'text/html').querySelector('.tc__host')?.textContent,
      ).toBe('(xn--pple-43d.com)');
    });

    it('warns about credentials in the address', () => {
      const doc = new DOMParser().parseFromString(
        decorateLinks('<a href="https://google.com@evil.example/">open</a>'),
        'text/html',
      );
      expect(doc.querySelector('.tc__host')?.textContent).toBe('(evil.example)');
      expect(doc.querySelector('.tc__warn')?.getAttribute('title')).toBe(LINK_WARNING_CREDENTIALS);
      expect(doc.querySelector('.tc__warn')?.getAttribute('aria-label')).toContain('Warning');
    });

    it('warns about direction-control characters in the address or the text', () => {
      const inText = new DOMParser().parseFromString(
        decorateLinks('<a href="https://example.com/">report\u202Egpj.exe</a>'),
        'text/html',
      );
      expect(inText.querySelector('.tc__warn')?.getAttribute('title')).toBe(LINK_WARNING_BIDI);

      const inHref = new DOMParser().parseFromString(
        decorateLinks('<a href="https://example.com/%E2%80%AEevil">x</a>'),
        'text/html',
      );
      // Percent-encoded controls are visible in the address and harmless; only raw ones are flagged.
      expect(inHref.querySelector('.tc__warn')).toBeNull();
    });

    it('warns when the link text names a different site, but not for www or a path on the same site', () => {
      const warns = (html: string): boolean =>
        new DOMParser()
          .parseFromString(decorateLinks(html), 'text/html')
          .querySelector('.tc__warn') !== null;

      expect(warns('<a href="https://evil.example/">paypal.com</a>')).toBe(true);
      expect(warns('<a href="https://evil.example/">https://paypal.com/login</a>')).toBe(true);
      expect(warns('<a href="https://example.com/a">www.example.com</a>')).toBe(false);
      expect(warns('<a href="https://www.example.com/a">example.com/docs</a>')).toBe(false);
      expect(warns('<a href="https://example.com/a">the quarterly report</a>')).toBe(false);
    });

    it('leaves mailto and unparsable links without a host mark, and returns plain text and nothing unchanged', () => {
      const doc = new DOMParser().parseFromString(
        decorateLinks('<a href="mailto:a@b.example">mail</a><a href="/relative">rel</a>'),
        'text/html',
      );
      expect(doc.querySelector('.tc__host')).toBeNull();
      expect(decorateLinks('<p>No links</p>')).toBe('<p>No links</p>');
      expect(decorateLinks('')).toBe('');
      expect(decorateLinks(null)).toBe('');
    });
  });

  describe('decorateLinks puts each table in a focusable, named scrolling box', () => {
    it('wraps a table once, as a region the keyboard can reach', () => {
      const out = decorateLinks('<p>a</p><table><tbody><tr><td>x</td></tr></tbody></table>');
      const doc = new DOMParser().parseFromString(out, 'text/html');
      const box = doc.querySelector('.mf-rich__scroll')!;
      expect(box.getAttribute('role')).toBe('region');
      expect(box.getAttribute('tabindex')).toBe('0');
      expect(box.getAttribute('aria-label')).toBe('Table');
      expect(box.querySelector(':scope > table')).not.toBeNull();
    });

    it('numbers several tables and leaves a table nested in a cell alone', () => {
      const out = decorateLinks(
        '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table><table><tr><td>b</td></tr></table>',
      );
      const doc = new DOMParser().parseFromString(out, 'text/html');
      const boxes = Array.from(doc.querySelectorAll('.mf-rich__scroll'));
      expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['Table 1', 'Table 2']);
      expect(doc.querySelectorAll('table table').length).toBe(1);
      expect(doc.querySelector('td .mf-rich__scroll')).toBeNull();
    });

    it('does not change anything for HTML without tables', () => {
      expect(decorateLinks('<p>a <b>b</b></p>')).toBe('<p>a <b>b</b></p>');
    });
  });

  describe('decorateLinks drops what is never rendered', () => {
    it('removes images, frames, forms and styles so a remote image cannot load', () => {
      const out = decorateLinks(
        '<p>a</p><img src="https://tracker.example/p.gif"><iframe src="x"></iframe><form><input></form><style>p{}</style><svg></svg><p>b</p>',
      );
      expect(out).toBe('<p>a</p><p>b</p>');
    });
  });

  describe('textToHtml (descriptions saved as plain text)', () => {
    it.each([
      ['one line', '<p>one line</p>'],
      ['a\nb', '<p>a<br>b</p>'],
      ['a\r\n\r\nb', '<p>a</p><p>b</p>'],
      ['  \n  ', ''],
      ['', ''],
      [
        '1 < 2 & <script>alert(1)</script>',
        '<p>1 &lt; 2 &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>',
      ],
      ['From John <john@example.com>', '<p>From John &lt;john@example.com&gt;</p>'],
      ['line 1  \nline 2', '<p>line 1<br>line 2</p>'],
    ])('turns %j into %j', (text, html) => {
      expect(textToHtml(text)).toBe(html);
    });

    it('is the same conversion as the server (so editing a text description does not change what it reads like)', () => {
      expect(textToHtml('Line one\nLine two\n\nSecond paragraph')).toBe(
        '<p>Line one<br>Line two</p><p>Second paragraph</p>',
      );
    });

    it('shows text descriptions escaped and rich ones as they are', () => {
      expect(descriptionToHtml('a <b>x</b>\nb', 'TEXT')).toBe('<p>a &lt;b&gt;x&lt;/b&gt;<br>b</p>');
      expect(descriptionToHtml('<p>a <b>x</b></p>', 'HTML')).toBe('<p>a <b>x</b></p>');
      expect(descriptionToHtml(undefined, 'HTML')).toBe('');
      expect(descriptionToHtml('x', undefined)).toBe('<p>x</p>');
    });
  });

  describe('htmlToPlainText', () => {
    it('puts rows on lines, separates cells and keeps paragraphs and list items on their own lines', () => {
      const html =
        '<p>Intro</p><table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Disk</td><td>2</td></tr></tbody></table><ul><li>a</li><li>b</li></ul>';
      expect(htmlToPlainText(html)).toBe('Intro\nName | Qty\nDisk | 2\na\nb');
    });

    it('treats line breaks as lines, decodes entities and ignores scripts', () => {
      expect(htmlToPlainText('<p>a<br>b &amp; c</p><script>alert(1)</script>')).toContain(
        'a\nb & c',
      );
      expect(htmlToPlainText(null)).toBe('');
    });

    it('does not end a row with a separator', () => {
      expect(htmlToPlainText('<table><tr><td>A</td><td></td></tr></table>')).toBe('A');
    });
  });

  describe('table cell helpers', () => {
    const build = (): { area: HTMLElement; cells: HTMLTableCellElement[] } => {
      const area = document.createElement('div');
      area.innerHTML =
        '<p>x</p><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td><table><tr><td>inner</td></tr></table></td></tr></table>';
      document.body.appendChild(area);
      return { area, cells: Array.from(area.querySelectorAll('td')) };
    };

    it('finds the cell of the caret (the innermost one) and the neighbours in reading order', () => {
      const { area, cells } = build();
      const selection = document.getSelection()!;
      placeCaret(cells[0], selection);
      expect(cellAtSelection(area, selection)).toBe(cells[0]);
      expect(neighbourCell(cells[0], false)).toBe(cells[1]);
      expect(neighbourCell(cells[1], false)).toBe(cells[2]);
      expect(neighbourCell(cells[1], true)).toBe(cells[0]);
      expect(neighbourCell(cells[0], true)).toBeNull();
      // The last cell of the outer table: the inner table's cell is not a neighbour of it.
      expect(neighbourCell(cells[3], false)).toBeNull();

      placeCaret(cells[4], selection);
      expect(cellAtSelection(area, selection)).toBe(cells[4]);
      expect(neighbourCell(cells[4], false)).toBeNull();
      area.remove();
    });

    it('finds no cell outside a table or outside the editor', () => {
      const { area } = build();
      const selection = document.getSelection()!;
      placeCaret(area.querySelector('p')!, selection);
      expect(cellAtSelection(area, selection)).toBeNull();
      expect(cellAtSelection(area, null)).toBeNull();
      const other = document.createElement('div');
      document.body.appendChild(other);
      placeCaret(other, selection);
      expect(cellAtSelection(area, selection)).toBeNull();
      area.remove();
      other.remove();
    });
  });
});
