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
      <p mfAfter data-x>Extra section</p>
    </mf-detail-layout>
  `,
})
class Host {}

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
    expect(aside.querySelector('[data-detail-body]')!.hasAttribute('hidden')).toBe(false);
  });

  it('puts the optional extra section inside the panel from 1100 px and after the main area below it', async () => {
    const wide = await render(1280);
    expect(wide.querySelector('aside [data-x]')).not.toBeNull();
    TestBed.resetTestingModule();

    const narrow = await render(768);
    expect(narrow.querySelector('aside [data-x]')).toBeNull();
    const layout = narrow.querySelector('[data-detail-layout]')!;
    const order = Array.from(layout.children).map((c) =>
      c.matches('aside') ? 'aside' : c.matches('[data-detail-main]') ? 'main' : 'after',
    );
    expect(order).toEqual(['aside', 'main', 'after']);
    expect(layout.querySelector('[data-detail-after] [data-x]')).not.toBeNull();
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

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.body.querySelector('.mf-drawer')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
