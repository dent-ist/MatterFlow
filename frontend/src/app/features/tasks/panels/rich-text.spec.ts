import { htmlToText, isBlankHtml, normalizeLink } from './rich-text';

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
});
