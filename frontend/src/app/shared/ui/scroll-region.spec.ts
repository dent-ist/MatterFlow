import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScrollRegion } from './scroll-region';

@Component({
  imports: [ScrollRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div id="box" [mfScrollRegion]="name()"><p>content</p></div>`,
})
class Host {
  readonly name = signal('Changes in this version');
}

describe('ScrollRegion (BUG-4)', () => {
  let fixture: ComponentFixture<Host>;
  let box: HTMLElement;
  const size = (scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: scrollHeight });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: clientHeight });
    window.dispatchEvent(new Event('resize'));
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    box = fixture.nativeElement.querySelector('#box');
  });

  it('adds nothing while the content fits', async () => {
    size(100, 100);
    await fixture.whenStable();
    expect(box.hasAttribute('tabindex')).toBe(false);
    expect(box.hasAttribute('role')).toBe(false);
    expect(box.hasAttribute('aria-label')).toBe(false);
  });

  it('becomes a named, focusable region while the content is taller than the box', async () => {
    size(600, 300);
    await fixture.whenStable();
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('aria-label')).toBe('Changes in this version');
    box.focus();
    expect(document.activeElement).toBe(box);
  });

  it('goes back to a plain box when the content fits again and with no name', async () => {
    size(600, 300);
    await fixture.whenStable();
    size(200, 300);
    await fixture.whenStable();
    expect(box.hasAttribute('tabindex')).toBe(false);
    size(600, 300);
    fixture.componentInstance.name.set('');
    await fixture.whenStable();
    expect(box.hasAttribute('tabindex')).toBe(false);
  });
});
