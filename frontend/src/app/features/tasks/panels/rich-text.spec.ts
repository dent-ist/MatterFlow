import {
  LINK_WARNING_BIDI,
  LINK_WARNING_CREDENTIALS,
  decorateLinks,
  htmlToText,
  isBlankHtml,
  normalizeLink,
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
});
