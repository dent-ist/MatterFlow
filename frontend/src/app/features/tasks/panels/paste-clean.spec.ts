import { MAX_PASTE_HTML, cleanPastedHtml } from './paste-clean';

const html = (input: string): string => {
  const result = cleanPastedHtml(input);
  if (result.kind !== 'html') throw new Error(`expected html, got ${result.reason}`);
  return result.html;
};

describe('cleanPastedHtml', () => {
  it('reduces an Outlook table to a plain table: no styles, classes, mso properties, o:p, fonts, conditional comments or spans', () => {
    const outlook = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">
      <style><!-- p.MsoNormal {margin:0in} td {mso-height-source:auto;} --></style>
      <!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head>
      <body lang=EN-US style='tab-interval:.5in'><!--StartFragment-->
      <table class=MsoTableGrid border=1 cellspacing=0 width=400 style='border-collapse:collapse;mso-yfti-tbllook:1184'>
        <tr style='mso-yfti-irow:0'>
          <td width=200 valign=top style='border:solid windowtext 1.0pt'><p class=MsoNormal><b><span style='mso-bidi-font-weight:normal'>Custodian<o:p></o:p></span></b></p></td>
          <td width=200 colspan=2 valign=top><p class=MsoNormal><span style='font-size:11.0pt'>Size</span><span></span><o:p></o:p></p></td>
        </tr>
        <tr><td><![if !supportLists]><![endif]><font face="Calibri" size="3">Smith, J</font></td><td>12 GB</td><td>&nbsp;</td></tr>
      </table><!--EndFragment--></body></html>`;
    expect(html(outlook)).toBe(
      '<table><tbody><tr><td><p><b>Custodian</b></p></td><td colspan="2"><p>Size</p></td></tr><tr><td>Smith, J</td><td>12 GB</td><td>&nbsp;</td></tr></tbody></table>',
    );
  });

  it('keeps merged cells, header cells with a valid scope, captions and column groups, and nothing else on them', () => {
    expect(
      html(
        '<table style="x" class="y"><caption style="z">Totals</caption><colgroup span="2"><col span="2" width="3"></colgroup><thead><tr><th scope="COL" style="a">A</th><th scope="banana" colspan="2" rowspan="1">B</th></tr></thead><tbody><tr><td rowspan="3" colspan="0" onclick="x()">1</td><td colspan="101">2</td><td colspan="2 onmouseover=x()">3</td></tr></tbody></table>',
      ),
    ).toBe(
      '<table><caption>Totals</caption><colgroup><col></colgroup><thead><tr><th scope="col">A</th><th colspan="2">B</th></tr></thead><tbody><tr><td rowspan="3">1</td><td>2</td><td>3</td></tr></tbody></table>',
    );
  });

  it('neutralises hostile markup (nothing from the source is moved over)', () => {
    const hostile =
      '<p onclick="alert(1)">Hi<script>alert(2)</script><img src=x onerror=alert(3)></p>' +
      '<table style="position:fixed"><tr><td onmouseover="alert(4)"><svg><style></style><a title="</style><img src onerror=alert(5)>"></svg>cell</td></tr></table>' +
      '<a href="javascript:alert(6)">js</a><a href="data:text/html,x">data</a><a href="https://example.com/ok" onclick="x()" target="_blank">ok</a>' +
      '<iframe srcdoc="<script>alert(7)</script>"></iframe><form action="x"><input value="v"><button>b</button></form><!-- c --><style>*{}</style>';
    const out = html(hostile);
    for (const bad of [
      'script',
      'onclick',
      'onerror',
      'onmouseover',
      'svg',
      'style',
      'iframe',
      'form',
      'input',
      'button',
      'javascript:',
      'data:',
      'img',
      '<!--',
      'alert',
    ]) {
      expect(out).not.toContain(bad);
    }
    expect(out).toContain('<td>cell</td>');
    expect(out).toContain('<a href="https://example.com/ok">ok</a>');
    expect(out).toContain('js');
    // Re-cleaning the result changes nothing.
    expect(html(out)).toBe(out);
  });

  it('unwraps the Google Docs wrapper but keeps real bold, and turns bold, italic and underline styles into formatting', () => {
    expect(html('<b style="font-weight:normal;" id="docs-internal-guid-1"><p>Plain</p></b>')).toBe(
      '<p>Plain</p>',
    );
    expect(
      html(
        '<p><span style="font-weight:700">B</span> <span style="font-style:italic">I</span> <span style="text-decoration:underline">U</span> <b>real</b></p>',
      ),
    ).toBe('<p><b>B</b> <i>I</i> <u>U</u> <b>real</b></p>');
  });

  it('turns divs and headings into paragraphs, keeps lists, and wraps loose text beside blocks', () => {
    expect(
      html(
        '<div>one</div><div><h2>two</h2></div><ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>loose',
      ),
    ).toBe('<p>one</p><p>two</p><ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><p>loose</p>');
  });

  it('leaves inline content inline, so pasting a few words into a line does not start a paragraph', () => {
    expect(html('<span style="color:red">some</span> <b>bold</b> words')).toBe(
      'some <b>bold</b> words',
    );
  });

  it('drops empty paragraphs but keeps blank lines made with a line break', () => {
    expect(html('<p><o:p></o:p></p><p>&nbsp;</p><p>text</p><p><br></p>')).toContain('<p>text</p>');
    expect(html('<p><o:p></o:p></p><p>text</p>')).toBe('<p>text</p>');
  });

  it('flattens tables nested deeper than three levels into paragraphs', () => {
    const deep =
      '<table><tr><td>L1<table><tr><td>L2<table><tr><td>L3<table><tr><td>L4<table><tr><td>L5</td></tr></table></td></tr></table></td></tr></table></td></tr></table></td></tr></table>';
    const out = html(deep);
    expect(out.match(/<table>/g)?.length).toBe(3);
    expect(out).toContain('L4');
    expect(out).toContain('L5');
    expect(html(out)).toBe(out);
  });

  it('ignores text and stray elements between table parts, as the browser parser would move them out of the table', () => {
    expect(html('<table>stray<tr>more<td>a</td></tr></table>')).toContain(
      '<table><tbody><tr><td>a</td></tr></tbody></table>',
    );
  });

  it('refuses a table over 200 cells and one over the size limit, so the plain text is pasted instead', () => {
    const cells = (n: number): string => `<table><tr>${'<td>x</td>'.repeat(n)}</tr></table>`;
    expect(cleanPastedHtml(cells(200))).toMatchObject({ kind: 'html', cells: 200 });
    expect(cleanPastedHtml(cells(201))).toEqual({ kind: 'text', reason: 'too-many-cells' });
    expect(cleanPastedHtml('x'.repeat(MAX_PASTE_HTML + 1))).toEqual({
      kind: 'text',
      reason: 'too-large',
    });
  });

  it('reports a paste with no content so the caller falls back to the text', () => {
    expect(cleanPastedHtml('<style>p{}</style><script>1</script><p><o:p></o:p></p>')).toEqual({
      kind: 'text',
      reason: 'empty',
    });
  });

  it('removes direction overrides from the text and collapses whitespace', () => {
    expect(html('<p>a‮b   c\n d</p>')).toBe('<p>ab c d</p>');
  });

  it('does not execute or load anything while reading (the source is parsed into an inert document)', () => {
    (window as unknown as { pwned?: number }).pwned = 0;
    html('<img src=x onerror="window.pwned=1"><script>window.pwned=2</script><p>ok</p>');
    expect((window as unknown as { pwned?: number }).pwned).toBe(0);
  });
});
