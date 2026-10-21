import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorkStrip, WorkStripItem } from './work-strip';

@Component({
  imports: [WorkStrip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-work-strip
    label="Summary"
    [items]="items()"
    [interactive]="interactive()"
    [active]="active()"
    [roving]="roving()"
    (pick)="picked.push($event)"
  />`,
})
class Host {
  readonly items = signal<WorkStripItem[]>([
    { key: 'a', label: 'Overdue', count: 4, alert: true },
    { key: 'b', label: 'Due today', count: 0 },
    { key: 'c', label: 'ASAP', count: null },
  ]);
  readonly interactive = signal(true);
  readonly active = signal<string | null>(null);
  readonly roving = signal(false);
  readonly picked: string[] = [];
}

describe('WorkStrip', () => {
  function create() {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('shows label and count per item, -- for an unknown count and the zero muted', () => {
    const { el } = create();
    expect(el.textContent!.replace(/\s+/g, ' ').trim()).toBe('Overdue 4 Due today 0 ASAP --');
    expect(el.querySelector('[data-strip-item="b"]')!.classList).toContain('zero');
    expect(el.querySelector('[data-strip-item="a"]')!.classList).toContain('alert');
    expect(el.querySelector('[data-strip-item="a"] .pi')).not.toBeNull();
  });

  it('shows a word or phrase in place of the number, cut with an ellipsis through CSS and whole in the tooltip (#380)', () => {
    const { f, el } = create();
    f.componentInstance.items.set([
      { key: 'form', label: 'Form', count: null, value: 'Published v2', hint: 'Request form' },
      { key: 'n', label: 'Workflows', count: 3 },
    ]);
    f.detectChanges();
    expect(el.textContent!.replace(/\s+/g, ' ').trim()).toBe('Form Published v2 Workflows 3');
    expect(el.querySelector('[data-strip-item="form"] .v')).not.toBeNull();
    expect(el.querySelector('[data-strip-item="n"] .v')).toBeNull();
    expect(el.querySelector('[data-strip-item="form"]')!.getAttribute('title')).toBe(
      'Request form',
    );
  });

  it('emits the key of a clicked item and marks the active one pressed', () => {
    const { f, el } = create();
    f.componentInstance.active.set('a');
    f.detectChanges();
    expect(el.querySelector('[data-strip-item="a"]')!.getAttribute('aria-pressed')).toBe('true');
    el.querySelector<HTMLButtonElement>('[data-strip-item="b"]')!.click();
    expect(f.componentInstance.picked).toEqual(['b']);
  });

  it('keeps an inert item as a plain count inside an interactive strip', () => {
    const { f, el } = create();
    f.componentInstance.items.set([
      { key: 'a', label: 'Active', count: 4 },
      { key: 'b', label: 'Inputs in draft', count: 2, inert: true },
    ]);
    f.detectChanges();
    expect(el.querySelectorAll('button').length).toBe(1);
    const inert = el.querySelector('[data-strip-item="b"]')!;
    expect(inert.tagName).toBe('SPAN');
    expect(inert.hasAttribute('aria-pressed')).toBe(false);
    expect(inert.textContent!.replace(/\s+/g, ' ').trim()).toBe('Inputs in draft 2');
  });

  it('renders plain text, no buttons, when not interactive', () => {
    const { f, el } = create();
    f.componentInstance.interactive.set(false);
    f.detectChanges();
    expect(el.querySelectorAll('button').length).toBe(0);
    expect(el.querySelectorAll('[data-strip-item]').length).toBe(3);
  });

  describe('link mode', () => {
    @Component({
      imports: [WorkStrip],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<mf-work-strip label="Client tasks" [items]="items()" />`,
    })
    class LinkHost {
      readonly items = signal<WorkStripItem[]>([
        {
          key: 'open',
          label: 'Open',
          count: 12,
          hint: 'Tasks that are open',
          link: { path: '/tasks', queryParams: { client: '107', status: ['NEW', 'ON_HOLD'] } },
        },
        {
          key: 'overdue',
          label: 'Overdue',
          count: 3,
          alert: true,
          link: { path: '/tasks', queryParams: { client: '107', overdue: 'true' } },
        },
        {
          key: 'asap',
          label: 'ASAP',
          count: 0,
          link: { path: '/tasks', queryParams: { asap: 'true' } },
        },
        { key: 'hold', label: 'On hold', count: null, link: { path: '/tasks' } },
      ]);
    }

    function link() {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const f = TestBed.createComponent(LinkHost);
      f.detectChanges();
      return { f, el: f.nativeElement as HTMLElement };
    }

    it('renders anchors with the router address, no buttons and no aria-pressed', () => {
      const { el } = link();
      const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[data-strip-item]'));
      expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
        '/tasks?client=107&status=NEW&status=ON_HOLD',
        '/tasks?client=107&overdue=true',
        '/tasks?asap=true',
        '/tasks',
      ]);
      expect(el.querySelectorAll('button').length).toBe(0);
      expect(el.querySelector('[aria-pressed]')).toBeNull();
      expect(anchors[0].getAttribute('title')).toBe('Tasks that are open');
    });

    it('keeps the zero muted in place, the overdue alert with icon and word, and -- for unknown', () => {
      const { el } = link();
      expect(el.textContent!.replace(/\s+/g, ' ').trim()).toBe(
        'Open 12 Overdue 3 ASAP 0 On hold --',
      );
      expect(el.querySelector('[data-strip-item="asap"]')!.classList).toContain('zero');
      const overdue = el.querySelector('[data-strip-item="overdue"]')!;
      expect(overdue.classList).toContain('alert');
      expect(overdue.querySelector('.pi')).not.toBeNull();
    });

    it('renders nothing for a strip without items', () => {
      const { f, el } = link();
      f.componentInstance.items.set([]);
      f.detectChanges();
      expect(el.querySelector('ul')).toBeNull();
      expect(el.querySelector('[data-strip]')).toBeNull();
    });

    it('is a toggle strip again when interactive, even if items carry a link', () => {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const f = TestBed.createComponent(WorkStrip);
      f.componentRef.setInput('items', [
        { key: 'a', label: 'Open', count: 1, link: { path: '/tasks' } },
      ]);
      f.componentRef.setInput('interactive', true);
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('a')).toBeNull();
      expect((f.nativeElement as HTMLElement).querySelector('button')).not.toBeNull();
    });
  });

  describe('roving tabindex (#429)', () => {
    const stops = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLElement>('button[data-strip-item]'))
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.dataset['stripItem']);

    it('is off by default: every button is a Tab stop and the list has no toolbar role', () => {
      const { el } = create();
      expect(stops(el)).toEqual(['a', 'b', 'c']);
      expect(el.querySelector('ul')!.getAttribute('role')).toBeNull();
    });

    it('makes one toolbar with one Tab stop (the pressed item, else the first) and arrow keys that move it', () => {
      const { f, el } = create();
      f.componentInstance.roving.set(true);
      f.componentInstance.active.set('b');
      f.detectChanges();
      const bar = el.querySelector('ul')!;
      expect(bar.getAttribute('role')).toBe('toolbar');
      expect(bar.getAttribute('aria-label')).toBe('Summary');
      expect(
        Array.from(bar.querySelectorAll('li')).every((li) => li.getAttribute('role') === 'none'),
      ).toBe(true);
      expect(stops(el)).toEqual(['b']);

      const b = el.querySelector<HTMLElement>('[data-strip-item="b"]')!;
      b.focus();
      b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      f.detectChanges();
      expect(document.activeElement).toBe(el.querySelector('[data-strip-item="c"]'));
      expect(stops(el)).toEqual(['c']);
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      expect(document.activeElement).toBe(el.querySelector('[data-strip-item="a"]'));
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      expect(document.activeElement).toBe(el.querySelector('[data-strip-item="c"]'));
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      );
      expect(document.activeElement).toBe(el.querySelector('[data-strip-item="a"]'));
    });

    it('tints an item only while its count is above zero', () => {
      const { f, el } = create();
      f.componentInstance.items.set([
        { key: 'w', label: 'Pending access', count: 3, tinted: true },
        { key: 'x', label: 'Waiting too', count: 0, tinted: true },
      ]);
      f.detectChanges();
      expect(el.querySelector('[data-strip-item="w"]')!.classList).toContain('tinted');
      expect(el.querySelector('[data-strip-item="x"]')!.classList).not.toContain('tinted');
    });
  });
});
