import { movesAway, placeFloating } from './float-position';

describe('placeFloating', () => {
  const rect = (r: Partial<DOMRect>): DOMRect =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...r }) as DOMRect;
  let trigger: HTMLElement;
  let panel: HTMLElement;

  const place = (t: Partial<DOMRect>, p: Partial<DOMRect>, align: 'start' | 'end' = 'end') => {
    trigger.getBoundingClientRect = () => rect(t);
    panel.getBoundingClientRect = () => rect(p);
    placeFloating(trigger, panel, align);
  };

  const original = { w: window.innerWidth, h: window.innerHeight };

  beforeEach(() => {
    trigger = document.createElement('button');
    panel = document.createElement('div');
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  });

  // The window size is shared by every spec of the run: put it back.
  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: original.h, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: original.w, configurable: true });
  });

  it('opens below the trigger, right-aligned, and shows the panel', () => {
    place({ top: 100, bottom: 130, left: 800, right: 900 }, { width: 200, height: 150 });
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.top).toBe('134px');
    expect(panel.style.left).toBe('700px');
    expect(panel.style.visibility).toBe('visible');
  });

  it('flips above when it does not fit below and there is more room above', () => {
    place({ top: 500, bottom: 530, left: 800, right: 900 }, { width: 200, height: 200 });
    expect(panel.style.top).toBe('296px');
  });

  it('stays below when neither side fits but below has more room', () => {
    place({ top: 100, bottom: 130, left: 800, right: 900 }, { width: 200, height: 580 });
    expect(panel.style.top).toBe('134px');
  });

  it('is kept inside the window at the left and right edges', () => {
    place({ top: 100, bottom: 130, left: 5, right: 30 }, { width: 200, height: 50 }, 'end');
    expect(panel.style.left).toBe('8px');
    place({ top: 100, bottom: 130, left: 950, right: 990 }, { width: 200, height: 50 }, 'start');
    expect(panel.style.left).toBe('792px');
  });

  it('a scroll or resize outside the panel moves the trigger away; a scroll inside it does not', () => {
    const inside = document.createElement('span');
    panel.appendChild(inside);
    expect(movesAway({ target: inside } as unknown as Event, panel)).toBe(false);
    expect(movesAway({ target: document } as unknown as Event, panel)).toBe(true);
    expect(movesAway({ target: window } as unknown as Event, panel)).toBe(true);
  });
});
