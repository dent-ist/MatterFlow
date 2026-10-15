import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { AuditEventsClient, UsersClient } from '../../api/generated/api-client';
import { ok, settle } from '../testing/org-testing';
import { ActivityDrawer } from './activity-drawer';
import { DetailLayout } from './detail-layout';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailLayout],
  template: `
    <mf-detail-layout>
      <p mfMain data-m>Main grid</p>
      <p mfAside data-a>Field values</p>
    </mf-detail-layout>
  `,
})
class Host {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailLayout],
  template: `
    <mf-detail-layout [split]="true" splitKey="test.split">
      <p mfMain data-m>Workflow</p>
      <div mfBelow data-b>Comments and Assets</div>
      <p mfAside data-a>Field values</p>
    </mf-detail-layout>
  `,
})
class SplitHost {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailLayout],
  template: `
    <mf-detail-layout [collapsible]="true">
      <p mfMain data-m>Main grid</p>
      <p mfAside data-a>Field values</p>
    </mf-detail-layout>
  `,
})
class CollapsibleHost {}

/** A `matchMedia` where the wide and tablet queries are on or off. */
function mockViewport(width: number): void {
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }) as never;
}

describe('DetailLayout', () => {
  const original = window.matchMedia;
  let fixture: ComponentFixture<Host>;
  afterEach(() => {
    window.matchMedia = original;
  });

  async function render(width: number | null) {
    if (width !== null) mockViewport(width);
    fixture = TestBed.createComponent(Host);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('puts the main area first and a labelled Details aside after it from 1100 px', async () => {
    const el = await render(1280);

    const layout = el.querySelector('[data-detail-layout]')!;
    expect(layout.getAttribute('data-layout')).toBe('wide');
    expect(layout.firstElementChild?.matches('[data-detail-main]')).toBe(true);
    const aside = el.querySelector('aside')!;
    expect(document.getElementById(aside.getAttribute('aria-labelledby')!)?.textContent).toContain(
      'Details',
    );
    expect(aside.querySelector('[data-a]')).not.toBeNull();
    expect(aside.querySelector('button')).toBeNull(); // no disclosure when it is a side panel
    expect((layout as HTMLElement).style.getPropertyValue('--dl-aside')).toBe('340px');
    expect(aside.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(false);
  });

  it('moves the panel above the main area below 1100 px, expanded on a tablet', async () => {
    const el = await render(768);

    const layout = el.querySelector('[data-detail-layout]')!;
    expect(layout.getAttribute('data-layout')).toBe('narrow');
    expect(layout.firstElementChild?.matches('aside')).toBe(true);
    const toggle = el.querySelector<HTMLButtonElement>('[data-detail-toggle]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-controls')).toBe(
      el.querySelector('[data-detail-body]')!.getAttribute('id'),
    );
  });

  it('starts collapsed on a phone and opens with the disclosure button', async () => {
    const el = await render(375);

    const toggle = el.querySelector<HTMLButtonElement>('[data-detail-toggle]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(true);
    toggle.click();
    await settle(fixture);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(false);
  });

  describe('collapsible (Matter and Project), UXR4-02', () => {
    afterEach(() => localStorage.removeItem('mf.detail-panel.open'));

    async function renderCollapsible(width: number) {
      mockViewport(width);
      const f = TestBed.createComponent(CollapsibleHost);
      await settle(f);
      return { f, el: f.nativeElement as HTMLElement };
    }

    it('starts collapsed between 1100 and 1399 px with a Details button, and the choice is remembered', async () => {
      const { f, el } = await renderCollapsible(1280);
      const layout = el.querySelector('[data-detail-layout]')!;
      expect(layout.getAttribute('data-layout')).toBe('wide-collapsible');
      const toggle = el.querySelector<HTMLButtonElement>('[data-detail-toggle]')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(el.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(true);
      expect(layout.classList).toContain('dl--slim');

      toggle.click();
      await settle(f);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(false);
      expect(layout.classList).not.toContain('dl--slim');
      expect(localStorage.getItem('mf.detail-panel.open')).toBe('1');
      f.destroy();

      const again = await renderCollapsible(1280);
      expect(again.el.querySelector('[data-detail-toggle]')!.getAttribute('aria-expanded')).toBe(
        'true',
      );
    });

    it('is always open, with no button, from 1400 px', async () => {
      const { el } = await renderCollapsible(1440);
      expect(el.querySelector('[data-detail-toggle]')).toBeNull();
      expect(el.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(false);
      expect(el.querySelector('[data-detail-layout]')!.getAttribute('data-layout')).toBe('wide');
    });
  });

  describe('split (the Task page): resizable columns', () => {
    const KEY = 'test.split';
    let splitFixture: ComponentFixture<SplitHost>;
    afterEach(() => {
      localStorage.removeItem(KEY);
      document.body.style.userSelect = '';
    });

    async function renderSplit(width = 1280) {
      mockViewport(width);
      splitFixture = TestBed.createComponent(SplitHost);
      await settle(splitFixture);
      const el = splitFixture.nativeElement as HTMLElement;
      return {
        el,
        layout: el.querySelector<HTMLElement>('[data-detail-layout]')!,
        handle: () => el.querySelector<HTMLElement>('[role=separator]'),
      };
    }

    const key = async (handle: HTMLElement, k: string, shiftKey = false) => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
      await settle(splitFixture);
    };
    const now = (handle: HTMLElement) => handle.getAttribute('aria-valuenow');

    function pointer(type: string, clientX: number, pointerId = 1): Event {
      const e = new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'pointerId', { value: pointerId });
      return e;
    }

    it('puts Workflow and the below sections in the left column and Details at the right, with a separator between', async () => {
      const { el, layout, handle } = await renderSplit();
      const kids = Array.from(layout.children).map((c) =>
        c.matches('[data-detail-left]')
          ? 'left'
          : c.matches('[role=separator]')
            ? 'handle'
            : 'aside',
      );
      expect(kids).toEqual(['left', 'handle', 'aside']);
      const left = el.querySelector('[data-detail-left]')!;
      expect(left.querySelector('[data-detail-main] [data-m]')).not.toBeNull();
      expect(left.querySelector('[data-detail-below] [data-b]')).not.toBeNull();
      expect(el.querySelector('aside [data-a]')).not.toBeNull();
      expect(layout.style.getPropertyValue('--dl-cols')).toBe(
        'minmax(0, 60fr) 1rem minmax(0, 40fr)',
      );

      const h = handle()!;
      expect(h.getAttribute('aria-orientation')).toBe('vertical');
      expect(h.getAttribute('aria-label')).toBe('Resize Details panel');
      expect(h.getAttribute('tabindex')).toBe('0');
      expect(now(h)).toBe('60');
      expect(h.getAttribute('aria-valuemin')).toBe('35');
      expect(h.getAttribute('aria-valuemax')).toBe('70');
      expect(h.getAttribute('title')).toContain('Double-click');
      expect(el.querySelector('[data-split-reset]')).toBeNull();
    });

    it('moves by 2 % with the arrow keys and 10 % with Shift, Home and End jump to the limits', async () => {
      const { handle } = await renderSplit();
      const h = handle()!;
      await key(h, 'ArrowLeft');
      expect(now(h)).toBe('58');
      await key(h, 'ArrowRight');
      await key(h, 'ArrowRight');
      expect(now(h)).toBe('62');
      await key(h, 'ArrowLeft', true);
      expect(now(h)).toBe('52');
      await key(h, 'Home');
      expect(now(h)).toBe('35');
      await key(h, 'ArrowLeft'); // clamped
      expect(now(h)).toBe('35');
      await key(h, 'End');
      expect(now(h)).toBe('70');
      await key(h, 'ArrowRight', true); // clamped
      expect(now(h)).toBe('70');
      expect(
        splitFixture.nativeElement
          .querySelector('[data-detail-layout]')
          .style.getPropertyValue('--dl-cols'),
      ).toBe('minmax(0, 70fr) 1rem minmax(0, 30fr)');
    });

    it('resets to 60 / 40 with Enter, a double click and the Reset layout button', async () => {
      const { el, handle } = await renderSplit();
      const h = handle()!;
      await key(h, 'Home');
      await key(h, 'Enter');
      expect(now(h)).toBe('60');

      await key(h, 'ArrowLeft', true);
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle(splitFixture);
      expect(now(h)).toBe('60');
      expect(localStorage.getItem(KEY)).toBeNull();

      await key(h, 'End');
      const reset = el.querySelector<HTMLButtonElement>('[data-split-reset]')!;
      expect(reset.textContent).toContain('Reset layout');
      reset.click();
      await settle(splitFixture);
      expect(now(h)).toBe('60');
      expect(el.querySelector('[data-split-reset]')).toBeNull();
    });

    it('is resized by dragging (pointer and touch): follows the pointer, clamps, disables text selection and restores it', async () => {
      const { layout, handle } = await renderSplit();
      const h = handle()!;
      layout.getBoundingClientRect = () => ({ left: 100, width: 1016 }) as DOMRect;
      document.body.style.userSelect = 'text';

      h.dispatchEvent(pointer('pointerdown', 700));
      await settle(splitFixture);
      expect(layout.classList).toContain('dl--dragging');
      expect(document.body.style.userSelect).toBe('none');

      // x = left + 8 + 65 % of (1016 - 16) -> 65 %
      h.dispatchEvent(pointer('pointermove', 100 + 8 + 650));
      await settle(splitFixture);
      expect(now(h)).toBe('65');
      expect(localStorage.getItem(KEY)).toBeNull(); // saved when the drag ends

      h.dispatchEvent(pointer('pointermove', 100 + 8 + 400)); // 40 %
      await settle(splitFixture);
      expect(now(h)).toBe('40');
      h.dispatchEvent(pointer('pointermove', 2000)); // far right: clamped to 70
      await settle(splitFixture);
      expect(now(h)).toBe('70');
      h.dispatchEvent(pointer('pointermove', 0)); // far left: clamped to 35
      await settle(splitFixture);
      expect(now(h)).toBe('35');
      h.dispatchEvent(pointer('pointermove', 100 + 8 + 400, 2)); // another pointer is ignored
      await settle(splitFixture);
      expect(now(h)).toBe('35');

      h.dispatchEvent(pointer('pointermove', 100 + 8 + 400));
      h.dispatchEvent(pointer('pointerup', 100 + 8 + 400));
      await settle(splitFixture);
      expect(layout.classList).not.toContain('dl--dragging');
      expect(document.body.style.userSelect).toBe('text'); // restored, not cleared
      expect(localStorage.getItem(KEY)).toBe('40');

      // moves after the end change nothing
      h.dispatchEvent(pointer('pointermove', 100 + 8 + 650));
      await settle(splitFixture);
      expect(now(h)).toBe('40');
    });

    it('remembers the width and restores it on the next visit without a jump (read before the first render)', async () => {
      const first = await renderSplit();
      await key(first.handle()!, 'ArrowRight', true);
      expect(localStorage.getItem(KEY)).toBe('70');
      splitFixture.destroy();

      mockViewport(1280);
      splitFixture = TestBed.createComponent(SplitHost);
      splitFixture.detectChanges();
      const layout = (splitFixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-detail-layout]',
      )!;
      expect(layout.style.getPropertyValue('--dl-cols')).toBe(
        'minmax(0, 70fr) 1rem minmax(0, 30fr)',
      );
    });

    it('ignores a stored width that is not a number and clamps one out of range', async () => {
      localStorage.setItem(KEY, 'wide');
      expect(now((await renderSplit()).handle()!)).toBe('60');
      splitFixture.destroy();
      localStorage.setItem(KEY, '12');
      expect(now((await renderSplit()).handle()!)).toBe('35');
    });

    it('works without storage (blocked or private window): nothing is remembered, nothing throws', async () => {
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { handle } = await renderSplit();
      await key(handle()!, 'ArrowLeft');
      expect(now(handle()!)).toBe('58');
      get.mockRestore();
      set.mockRestore();
    });

    it('has no splitter below 1100 px: Details first, then the left column in one flow', async () => {
      const { el, layout, handle } = await renderSplit(768);
      expect(handle()).toBeNull();
      expect(layout.style.getPropertyValue('--dl-cols')).toBe('');
      const kids = Array.from(layout.children).map((c) => (c.matches('aside') ? 'aside' : 'left'));
      expect(kids).toEqual(['aside', 'left']);
      expect(el.querySelector('[data-split-reset]')).toBeNull();
      const left = el.querySelector('[data-detail-left]')!;
      expect(Array.from(left.children).map((c) => c.getAttribute('class'))).toEqual([
        'dl__main',
        'dl__below',
      ]);
    });

    it('does not add a splitter to the other detail pages', async () => {
      const el = await render(1280);
      expect(el.querySelector('[role=separator]')).toBeNull();
      expect(el.querySelector('[data-detail-left]')).toBeNull();
    });
  });

  it('uses the wide layout when the browser has no matchMedia', async () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    const el = await render(null);
    expect(el.querySelector('[data-detail-layout]')!.getAttribute('data-layout')).toBe('wide');
  });
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityDrawer],
  template: `
    <button type="button" id="open" (click)="shown = true">Activity</button>
    <mf-activity-drawer
      objectType="Client"
      [objectId]="1"
      name="Acme Corp"
      [visible]="shown"
      (visibleChange)="shown = $event"
    />
  `,
})
class DrawerHost {
  shown = false;
}

describe('ActivityDrawer', () => {
  it('is a modal dialog titled with the record, closes on Escape and returns focus to the opener', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        {
          provide: AuditEventsClient,
          useValue: { listAuditEvents: vi.fn().mockReturnValue(ok({ items: [] })) },
        },
        { provide: UsersClient, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(DrawerHost);
    await settle(fixture);
    const opener = fixture.nativeElement.querySelector('#open') as HTMLButtonElement;
    opener.focus();
    opener.click();
    await settle(fixture);

    const dialog = document.body.querySelector('.mf-drawer') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Activity: Acme Corp');
    expect(dialog.textContent).toContain('No activity recorded yet.');
    // Every Activity drawer opens on its Close button (UXR4-20).
    expect(document.activeElement).toBe(
      dialog.querySelector('button[aria-label="Close activity"]'),
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.body.querySelector('.mf-drawer')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
