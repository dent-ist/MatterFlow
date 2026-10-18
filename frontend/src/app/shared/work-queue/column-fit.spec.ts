import { WORK_COLUMNS } from './column-prefs';
import { FIT_PADDING_PX, contentWidth, fitColumn, fitWidth } from './column-fit';

const def = (key: string) => WORK_COLUMNS.find((c) => c.key === key)!;

describe('fitWidth (#205)', () => {
  it('is the widest content plus the padding, in whole px', () => {
    expect(fitWidth(def('matter'), [120, 188.2, 90])).toBe(Math.ceil(188.2 + FIT_PADDING_PX));
    expect(fitWidth(def('matter'), [150], 20)).toBe(170);
  });

  it('clamps to the column minimum and maximum', () => {
    expect(fitWidth(def('matter'), [20])).toBe(112);
    expect(fitWidth(def('matter'), [900])).toBe(320);
    expect(fitWidth(def('due'), [10])).toBe(120);
    expect(fitWidth(def('due'), [10_000])).toBe(200);
  });

  it('an empty page, or nothing usable, keeps the default width', () => {
    expect(fitWidth(def('due'), [])).toBe(136);
    expect(fitWidth(def('due'), [NaN, 0, -4])).toBe(136);
  });

  it('ignores numbers that are not widths', () => {
    expect(fitWidth(def('status'), [NaN, 130, Infinity])).toBe(146);
  });

  it('has no width for the Title, which fills the space left', () => {
    expect(fitWidth(def('title'), [500])).toBeNull();
  });
});

describe('content measurement (#205)', () => {
  // jsdom has no layout: every text node is 7 px per character from x = 10 and every leaf element 14 px wide, which is all the walk needs.
  let rangeNode: Node | null = null;
  const textRect = (len: number): DOMRect =>
    ({ left: 10, right: 10 + len * 7, width: len * 7, height: 18 }) as DOMRect;

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return { left: 10, right: 24, width: 14, height: 14 } as DOMRect;
    });
    if (!('getBoundingClientRect' in Range.prototype)) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => textRect((rangeNode?.textContent ?? '').trim().length),
      });
    }
    vi.spyOn(Range.prototype, 'selectNodeContents').mockImplementation((n: Node) => {
      rangeNode = n;
    });
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() =>
      textRect((rangeNode?.textContent ?? '').trim().length),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const cell = (html: string): HTMLElement => {
    const td = document.createElement('td');
    td.innerHTML = html;
    document.body.append(td);
    return td;
  };

  it('takes the widest text, icons included, and counts text that an ellipsis would cut', () => {
    const td = cell('<span class="wt-clip">Merger Review</span><i class="pi pi-bolt"></i>');
    expect(contentWidth(td, document.createRange())).toBe(13 * 7);
    td.remove();
  });

  it('skips screen-reader text, hidden things and the drag handle', () => {
    const td = cell(
      '<span>Due</span><span class="mf-sr-only">a very long sentence only a screen reader hears</span><span hidden>hidden text</span><span class="wt-resize"></span>',
    );
    expect(contentWidth(td, document.createRange())).toBe(3 * 7);
    td.remove();
  });

  it('skips a visually hidden sentence whatever its class (a 1 px box)', () => {
    const td = cell('<span>Due</span><span class="dc-sr">Due Jul 30, overdue 80 days</span>');
    const box = vi.mocked(Element.prototype.getBoundingClientRect);
    box.mockImplementation(function (this: Element) {
      return this.classList.contains('dc-sr')
        ? ({ left: 10, right: 11, width: 1, height: 1 } as DOMRect)
        : ({ left: 10, right: 24, width: 14, height: 14 } as DOMRect);
    });
    expect(contentWidth(td, document.createRange())).toBe(3 * 7);
    td.remove();
  });

  it('a block that only holds text is not a box of its own (it stretches to the cell), an inline-level control is', () => {
    const td = cell('<div>Due</div><span style="display: inline-flex"><b>OK</b></span>');
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      return this.localName === 'div'
        ? ({ left: 10, right: 194, width: 184, height: 18 } as DOMRect)
        : this.localName === 'span'
          ? ({ left: 10, right: 50, width: 40, height: 18 } as DOMRect)
          : ({ left: 10, right: 24, width: 14, height: 14 } as DOMRect);
    });
    // The "Due" text is 21 px and the control is 40 px: the 184 px block is ignored.
    expect(contentWidth(td, document.createRange())).toBe(40);
    td.remove();
  });

  it('an empty cell is 0', () => {
    const td = cell('   ');
    expect(contentWidth(td, document.createRange())).toBe(0);
    td.remove();
  });

  it('measures a column in one pass and puts the width back', () => {
    document.body.innerHTML = `<table><colgroup><col data-col="matter" style="width: 11.4rem"></colgroup>
      <thead><tr><th data-col="matter"><button>Matter</button></th></tr></thead>
      <tbody><tr data-task="1"><td data-col="matter"><span>A long matter name here</span></td></tr>
      <tr data-task="2"><td data-col="matter"><span>Short</span></td></tr></tbody></table>`;
    const table = document.querySelector('table')!;
    const col = table.querySelector('col')!;
    const widths: string[] = [];
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(table, 'offsetWidth', {
      get: () => {
        widths.push(col.style.width);
        return 0;
      },
    });
    const px = fitColumn(table, def('matter'), 14);
    // 23 characters at 7 px + the padding read from the cells (jsdom's own 1 px on each side).
    expect(px).toBe(23 * 7 + 2);
    expect(widths).toEqual([`${320 / 14}rem`]); // one forced layout, with the column opened to its maximum
    expect(col.style.width).toBe('11.4rem');
    expect(proto).toBeDefined();
    table.remove();
  });

  it('scales to the default zoom when the root font is larger', () => {
    document.body.innerHTML = `<table><colgroup><col data-col="due" style="width: 9rem"></colgroup>
      <thead><tr><th data-col="due"><button>Due</button></th></tr></thead>
      <tbody><tr data-task="1"><td data-col="due"><span>0123456789</span></td></tr></tbody></table>`;
    const table = document.querySelector('table')!;
    // 10 characters = 70 px at 21 px root (zoom 1.5) = 46.67 px at the default zoom, plus 16 -> 62.67, clamped to Due's minimum.
    expect(fitColumn(table, def('due'), 21)).toBe(120);
    table.remove();
  });

  it('has nothing to measure for the Title', () => {
    expect(fitColumn(document.createElement('table'), def('title'), 14)).toBeNull();
  });
});
