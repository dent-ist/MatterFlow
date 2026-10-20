import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SkipTarget } from '../layout/skip-target';
import { ShortcutRegistry } from '../layout/shortcut-registry';
import { DrillReturn } from '../work-queue/drill';
import { CopyButton } from './copy-button';
import {
  RowLink,
  isPlainClick,
  registerTableSkip,
  restoreRowFocus,
  restoreTabFocus,
} from './row-nav';

@Component({
  selector: 'mf-test-list',
  imports: [RowLink, CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 data-page-title>Things</h1>
    <table>
      <tbody>
        @for (id of ids(); track id) {
          <tr>
            <td><mf-copy-button text="X" label="number" [rowStop]="true" /></td>
            <td>
              <a
                href="javascript:void(0)"
                mfRowLink="things"
                [rowKey]="id"
                (click)="$event.preventDefault()"
                >Thing {{ id }}</a
              >
              <a href="javascript:void(0)" class="other" (click)="$event.preventDefault()"
                >Other {{ id }}</a
              >
            </td>
          </tr>
        }
      </tbody>
    </table>
    <div role="tablist"><button role="tab" aria-selected="true">Overview</button></div>
  `,
})
class ListHost {
  readonly ids = signal([1, 2, 3]);
  readonly ready = signal(false);
  constructor() {
    registerTableSkip({ copyButton: true });
    restoreRowFocus('things', () => this.ready());
  }
}

@Component({
  selector: 'mf-test-record',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div role="tablist"><button role="tab" aria-selected="true">Overview</button></div>`,
})
class RecordHost {
  constructor() {
    restoreTabFocus(() => true, ['things']);
  }
}

@Component({
  selector: 'mf-test-record-plain',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div role="tablist"><button role="tab" aria-selected="true">Overview</button></div>`,
})
class PlainRecordHost {
  constructor() {
    restoreTabFocus(() => true, []);
  }
}

describe('row navigation (#281, #282, #283)', () => {
  let fixture: ComponentFixture<ListHost>;
  let drill: DrillReturn;
  const root = (): HTMLElement => fixture.nativeElement;
  const link = (id: number): HTMLAnchorElement =>
    root().querySelector<HTMLAnchorElement>(`a[data-row-key="${id}"]`)!;

  async function create(returning: boolean): Promise<void> {
    // Other specs of the same run may leave their page in the document; this one looks at its own headings and focus.
    document.querySelectorAll('[data-page-title]').forEach((e) => e.remove());
    (document.activeElement as HTMLElement | null)?.blur();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
    drill = TestBed.inject(DrillReturn);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/things');
    drill.leaveRow('things', 2);
    await router.navigateByUrl('/thing/2');
    await router.navigateByUrl('/things', returning ? { state: { restoreFocus: true } } : {});
    fixture = TestBed.createComponent(ListHost);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => fixture?.nativeElement.remove());

  it('marks the name link with its list and key', async () => {
    await create(false);
    expect(link(2).getAttribute('data-row-list')).toBe('things');
  });

  it('remembers the row on a plain click only', async () => {
    await create(false);
    const spy = vi.spyOn(drill, 'leaveRow');
    link(1).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    link(1).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 }));
    expect(spy).not.toHaveBeenCalled();
    link(3).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(spy).toHaveBeenCalledWith('things', 3);
  });

  it('isPlainClick refuses modified and non-primary clicks', () => {
    expect(isPlainClick(new MouseEvent('click'))).toBe(true);
    expect(isPlainClick(new MouseEvent('click', { shiftKey: true }))).toBe(false);
    expect(isPlainClick(new MouseEvent('click', { metaKey: true }))).toBe(false);
    expect(isPlainClick(new MouseEvent('click', { button: 2 }))).toBe(false);
  });

  it('focuses the row that was left once the list is ready, and not before', async () => {
    await create(true);
    expect(document.activeElement).not.toBe(link(2));
    fixture.componentInstance.ready.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(link(2));
  });

  it('focuses the page heading when the row is not on the page any more', async () => {
    await create(true);
    fixture.componentInstance.ids.set([1, 3]);
    fixture.componentInstance.ready.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(root().querySelector('[data-page-title]'));
  });

  it('does nothing when the list was not reached by a return', async () => {
    await create(false);
    fixture.componentInstance.ready.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(document.body);
  });

  it('the copy button is out of the Tab order, and the right arrow on the link steps to it', async () => {
    await create(false);
    const button = root().querySelectorAll<HTMLButtonElement>('button[data-row-stop]')[0];
    expect(button.getAttribute('tabindex')).toBe('-1');
    expect(button.getAttribute('aria-label')).toBe('Copy number');
    link(1).focus();
    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    link(1).dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button);
    // Back: the left arrow and Shift+Tab return to the link; Tab goes on from the link's place.
    const left = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(left);
    expect(document.activeElement).toBe(link(1));
    button.focus();
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link(1));
    button.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    button.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false); // the browser's own Tab continues from the link
    expect(document.activeElement).toBe(link(1));
  });

  it('other keys on the link are left alone', async () => {
    await create(false);
    link(1).focus();
    for (const init of [
      { key: 'Tab' },
      { key: 'ArrowRight', shiftKey: true },
      { key: 'ArrowLeft' },
    ]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      link(1).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(link(1));
    }
  });

  it('offers "Skip to table" and lists it in the help while the list is open, and takes both away after', async () => {
    await create(false);
    const skip = TestBed.inject(SkipTarget);
    const registry = TestBed.inject(ShortcutRegistry);
    expect(skip.target()?.label).toBe('Skip to table');
    const ids = registry.all().map((s) => s.id);
    expect(ids).toContain('skip-table');
    expect(ids).toContain('row-copy');
    skip.target()!.focus();
    expect(document.activeElement).toBe(link(1));
    fixture.destroy();
    expect(skip.target()).toBeNull();
    expect(registry.all().map((s) => s.id)).not.toContain('skip-table');
  });

  it('focuses the selected tab after a return, unless the row left is in a list inside the page', async () => {
    await create(true);
    // The list host carries the skip target id (so it keeps its test root alive): take its tab out of the way.
    fixture.nativeElement.remove();
    const plain = TestBed.createComponent(PlainRecordHost);
    document.body.appendChild(plain.nativeElement);
    plain.detectChanges();
    await plain.whenStable();
    expect(document.activeElement).toBe(plain.nativeElement.querySelector('[role=tab]'));
    // Once only: a second record page in the same return gets nothing.
    plain.nativeElement.querySelector('button').blur();
    const again = TestBed.createComponent(PlainRecordHost);
    document.body.appendChild(again.nativeElement);
    again.detectChanges();
    await again.whenStable();
    expect(document.activeElement).toBe(document.body);
    plain.nativeElement.remove();
    again.nativeElement.remove();
  });

  it('leaves the tab alone when the row left belongs to a list inside the page (that list focuses its own row)', async () => {
    await create(true);
    const own = TestBed.createComponent(RecordHost);
    document.body.appendChild(own.nativeElement);
    own.detectChanges();
    await own.whenStable();
    expect(document.activeElement).toBe(document.body);
    own.nativeElement.remove();
  });
});
