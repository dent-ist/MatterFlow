import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RowLink, RowStop } from './row-nav';

@Component({
  selector: 'mf-test-row-stops',
  imports: [RowLink, RowStop],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table>
      <tbody>
        <tr>
          <td>
            <a href="#" mfRowLink="things" [rowKey]="1" id="name" (click)="$event.preventDefault()"
              >Thing</a
            >
          </td>
          <td><a href="#" mfRowStop id="a">2 workflows</a></td>
          <td><a href="#" mfRowStop id="b">5 open tasks</a></td>
          <td><button id="menu">Actions</button></td>
        </tr>
        <tr>
          <td><a href="#" mfRowLink="things" [rowKey]="2" id="name2">Other</a></td>
          <td><button id="menu2">Actions</button></td>
        </tr>
      </tbody>
    </table>
    <a href="#" [mfRowStop]="false" id="plain">Plain</a>
  `,
})
class Host {}

describe('RowStop (#413): the secondary links of a list row', () => {
  let fixture: ComponentFixture<Host>;
  const el = (id: string): HTMLElement => fixture.nativeElement.querySelector(`#${id}`);
  const key = (from: HTMLElement, k: string, shiftKey = false): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key: k,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    from.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });
  afterEach(() => fixture.nativeElement.remove());

  it('takes the link out of the Tab order and marks it as a row stop', () => {
    expect(el('a').getAttribute('tabindex')).toBe('-1');
    expect(el('a').hasAttribute('data-row-stop')).toBe(true);
    expect(el('plain').hasAttribute('tabindex')).toBe(false);
    expect(el('plain').hasAttribute('data-row-stop')).toBe(false);
  });

  it('the right arrow on the name steps to the first stop, and on through the row', () => {
    el('name').focus();
    expect(key(el('name'), 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('a'));
    key(el('a'), 'ArrowRight');
    expect(document.activeElement).toBe(el('b'));
    // The last stop has nothing to its right: the key is left alone.
    expect(key(el('b'), 'ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(el('b'));
  });

  it('the left arrow goes back stop by stop and then to the name', () => {
    el('b').focus();
    key(el('b'), 'ArrowLeft');
    expect(document.activeElement).toBe(el('a'));
    key(el('a'), 'ArrowLeft');
    expect(document.activeElement).toBe(el('name'));
  });

  it('Shift+Tab and Tab go through the name link (the browser then continues from it)', () => {
    el('b').focus();
    expect(key(el('b'), 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('name'));
    el('a').focus();
    expect(key(el('a'), 'Tab').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(el('name'));
  });

  it('a row without stops leaves the right arrow alone', () => {
    el('name2').focus();
    expect(key(el('name2'), 'ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(el('name2'));
  });

  it('ignores modified arrows', () => {
    el('name').focus();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    el('name').dispatchEvent(event);
    expect(document.activeElement).toBe(el('name'));
  });
});
