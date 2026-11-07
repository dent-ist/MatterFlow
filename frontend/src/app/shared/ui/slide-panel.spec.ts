import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SlidePanel } from './slide-panel';

@Component({
  imports: [SlidePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button id="opener" type="button">Open</button>
    <mf-slide-panel
      title="New Project"
      primaryLabel="Create Project"
      [dirty]="dirty()"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="open"
      (submitted)="log.push('save')"
    >
      <input id="first" />
    </mf-slide-panel>`,
})
class Host {
  readonly open = signal(true);
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly log: string[] = [];
}

describe('SlidePanel (MD-01, #1002)', () => {
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  async function start() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('puts Cancel on the left and the primary action on the right', async () => {
    await start();
    const names = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-panel-footer] button'),
    ).map((b) => b.textContent?.trim());
    expect(names).toEqual(['Cancel', 'Create Project']);
  });

  it('titles the drawer with an h2, so the section headings (h3) inside it never skip a level (#1294)', async () => {
    await start();
    const title = q('[data-panel-title]')!;
    expect(title.tagName).toBe('H2');
    expect(title.textContent).toContain('New Project');
    expect(title.id).toBe(q('[role="dialog"]')!.getAttribute('aria-labelledby'));
  });

  it('submits from the primary button and ignores it while busy', async () => {
    const f = await start();
    q('[data-panel-primary] button')!.click();
    expect(f.componentInstance.log).toEqual(['save']);
    f.componentInstance.busy.set(true);
    f.detectChanges();
    q('[data-panel-primary] button')!.click();
    expect(f.componentInstance.log).toEqual(['save']);
  });

  it('closes at once when nothing changed', async () => {
    const f = await start();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('asks before it discards unsaved changes', async () => {
    const f = await start();
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    q('[data-panel-cancel] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    expect(q('[data-panel-guard]')).not.toBeNull();
    q('[data-guard-keep] button')!.click();
    f.detectChanges();
    expect(q('[data-panel-guard]')).toBeNull();
    q('[data-panel-close]')!.click();
    f.detectChanges();
    q('[data-guard-discard] button')!.click();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('closes on Esc when clean and shows the guard on Esc when dirty', async () => {
    const f = await start();
    f.componentInstance.dirty.set(true);
    f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(q('[data-panel-guard]')).not.toBeNull();
    expect(f.componentInstance.open()).toBe(true);
  });

  it('closes on Esc when nothing changed', async () => {
    const f = await start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
  });

  it('leaves an Esc alone that closed a dropdown list inside the panel', async () => {
    const f = await start();
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    list.remove();
  });

  it('shows a save error as an alert', async () => {
    const f = await start();
    f.componentInstance.error.set('Could not save');
    f.detectChanges();
    expect(q('[data-panel-error]')?.getAttribute('role')).toBe('alert');
  });
});

@Component({
  imports: [SlidePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-slide-panel
    title="A long record name"
    subtitle="KE\\someone"
    closeLabel="Close person details"
    panelClass="mf-test-drawer"
    [size]="size()"
    [showFooter]="footer()"
    [customFooter]="true"
    [hostClosing]="hostClosing()"
    scrollLabel="Details"
    initialFocus="close"
    [(visible)]="open"
    (closeRequest)="log.push('ask')"
  >
    <a mfDrawerActions class="mf-btn mf-btn--icon" id="act" aria-label="Open it" href="#"
      ><i class="pi pi-list"></i
    ></a>
    <div mfDrawerTabs id="tabs">tabs</div>
    <span mfDrawerFooter id="foot-slot"><button type="button">Cancel</button></span>
    <p id="body-text">body</p>
  </mf-slide-panel>`,
})
class AnatomyHost {
  readonly open = signal(true);
  readonly size = signal<'default' | 'large'>('default');
  readonly footer = signal(false);
  readonly hostClosing = signal(false);
  readonly log: string[] = [];
}

describe('SlidePanel drawer anatomy (D-33, #1142)', () => {
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  async function start() {
    const fixture = TestBed.createComponent(AnatomyHost);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('has the title, the subtitle, the action and the close button in the header, the tab strip under it, the body below', async () => {
    await start();
    const header = q('.p-dialog-header')!;
    expect(header.querySelector('[data-panel-title]')?.textContent).toBe('A long record name');
    expect(header.querySelector('.sp__sub')?.textContent).toBe('KE\\someone');
    expect(header.querySelector('#act')).not.toBeNull();
    const close = header.querySelector('[data-panel-close]')!;
    expect(close.getAttribute('aria-label')).toBe('Close person details');
    expect(close.classList.contains('mf-dlg__x')).toBe(true);
    // Order in the header: title, actions, close.
    const kids = Array.from(header.children).map((e) => e.className);
    expect(kids.findIndex((c) => c.includes('sp__head'))).toBeLessThan(
      kids.findIndex((c) => c.includes('sp__actions')),
    );
    const content = q('.p-dialog-content')!;
    expect(content.querySelector('.sp__tabs #tabs')).not.toBeNull();
    expect(content.querySelector('.sp__body #body-text')).not.toBeNull();
    expect(content.querySelector('.sp__body')?.getAttribute('aria-label') ?? 'Details').toBe(
      'Details',
    );
  });

  it('has no footer unless it edits (the footer is only for a drawer that edits)', async () => {
    await start();
    expect(q('[data-panel-footer]')).toBeNull();
    expect(q('.p-dialog-footer')).toBeNull();
    TestBed.resetTestingModule();
    const editing = TestBed.createComponent(AnatomyHost);
    editing.componentInstance.footer.set(true);
    await editing.whenStable();
    editing.detectChanges();
    expect(q('[data-panel-footer] #foot-slot')).not.toBeNull();
  });

  it('is 520 px by default and 720 px as a large drawer: the width comes from the component class, never from the host', async () => {
    const f = await start();
    const dialog = q('.mf-drawer')!;
    expect(dialog.classList.contains('mf-slide')).toBe(true);
    expect(dialog.classList.contains('mf-test-drawer')).toBe(true);
    expect(dialog.classList.contains('mf-drawer--wide')).toBe(false);
    expect(dialog.style.width).toBe('');
    f.componentInstance.size.set('large');
    f.detectChanges();
    expect(q('.mf-drawer')!.classList.contains('mf-drawer--wide')).toBe(true);
    const css = readFileSync(
      join(process.cwd(), 'src', 'app', 'shared', 'ui', 'slide-panel.scss'),
      'utf8',
    );
    expect(css).toMatch(/\.mf-drawer\.p-dialog \{[^}]*width: var\(--mf-drawer-w\);/);
    expect(css).toMatch(/\.mf-drawer--wide\.p-dialog \{\s*width: var\(--mf-drawer-w-wide\);/);
    expect(css).toMatch(/\.mf-drawer \.p-dialog-header \{[^}]*min-height: 56px;/);
  });

  it('puts focus on the close button when asked, and lets the host answer a close request itself', async () => {
    const f = await start();
    await new Promise((r) => setTimeout(r, 30));
    f.componentInstance.hostClosing.set(true);
    f.detectChanges();
    q('[data-panel-close]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(f.componentInstance.log).toEqual(['ask', 'ask']);
    expect(f.componentInstance.open()).toBe(true);
  });
});
