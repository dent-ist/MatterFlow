import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dismissable, PopoverStack } from './dismissable';

@Component({
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input id="text" />
    <button #a id="a" type="button" (click)="a1.set(!a1())">A</button>
    @if (a1()) {
      <div id="pa" [mfDismissable]="a" (dismissed)="a1.set(false)">
        <button id="inner-a" type="button" (click)="nested.set(true)">open nested</button>
        @if (nested()) {
          <div id="nested" [mfDismissable]="null" (dismissed)="nested.set(false)">
            <button id="inner-n" type="button">n</button>
          </div>
        }
      </div>
    }
    <button #b id="b" type="button" (click)="b1.set(!b1())">B</button>
    @if (b1()) {
      <div id="pb" [mfDismissable]="b" (dismissed)="b1.set(false)">
        <button type="button">x</button>
      </div>
    }
    <button id="outside" type="button">outside</button>
  `,
})
class Host {
  readonly a1 = signal(false);
  readonly b1 = signal(false);
  readonly nested = signal(false);
}

describe('Dismissable (one popover rule)', () => {
  let fixture: ComponentFixture<Host>;
  const q = <T extends HTMLElement>(sel: string) => fixture.nativeElement.querySelector(sel) as T;
  const esc = (target: Element = document.activeElement ?? document.body) => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await settle();
  });

  it('Esc closes the popover and gives the trigger focus back', async () => {
    q('#a').click();
    await settle();
    q('#inner-a').focus();
    const e = esc();
    await settle();
    expect(q('#pa')).toBeNull();
    expect(document.activeElement).toBe(q('#a'));
    expect(e.defaultPrevented).toBe(true);
  });

  it('keeps Esc from the page while a popover is open, and leaves it alone otherwise', async () => {
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as KeyboardEvent).key);
    document.body.addEventListener('keydown', listener);
    q('#a').click();
    await settle();
    esc(q('#inner-a'));
    expect(seen).toEqual([]);
    esc(q('#outside'));
    expect(seen).toEqual(['Escape']);
    document.body.removeEventListener('keydown', listener);
  });

  it('closes on a press outside (focus stays where the user put it) but not on its trigger or inside', async () => {
    q('#a').click();
    await settle();
    q('#inner-a').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    q('#a').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(q('#pa')).not.toBeNull();
    q('#outside').focus();
    q('#outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(q('#pa')).toBeNull();
    expect(document.activeElement).toBe(q('#outside'));
  });

  it('closes when focus moves outside', async () => {
    q('#a').click();
    await settle();
    q('#inner-a').focus();
    q('#outside').focus();
    await settle();
    expect(q('#pa')).toBeNull();
  });

  it('opening another popover closes the first without moving focus', async () => {
    q('#a').click();
    await settle();
    q('#b').focus();
    q('#b').click();
    await settle();
    expect(q('#pa')).toBeNull();
    expect(q('#pb')).not.toBeNull();
    expect(document.activeElement).toBe(q('#b'));
    expect(TestBed.inject(PopoverStack).depth).toBe(1);
  });

  it('closes the topmost first: a nested popover goes on Esc, then its parent', async () => {
    q('#a').click();
    await settle();
    q('#inner-a').click();
    await settle();
    expect(q('#nested')).not.toBeNull();
    q('#inner-n').focus();
    esc();
    await settle();
    expect(q('#nested')).toBeNull();
    expect(q('#pa')).not.toBeNull();
    esc();
    await settle();
    expect(q('#pa')).toBeNull();
  });

  it('removes its document listeners when the last popover closes', async () => {
    q('#a').click();
    await settle();
    q('#a').click();
    await settle();
    expect(TestBed.inject(PopoverStack).depth).toBe(0);
    const e = esc(q('#outside'));
    expect(e.defaultPrevented).toBe(false);
  });
});
