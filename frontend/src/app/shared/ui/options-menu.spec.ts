import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OptionsMenu } from './options-menu';

@Component({
  imports: [OptionsMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" id="outside">Elsewhere</button>
    <mf-options-menu label="Needs my attention" [active]="active">
      <button type="button" id="plain">Plain</button>
      <button type="button" id="pick" data-options-pick>Pick</button>
    </mf-options-menu>
  `,
})
class Host {
  active = 0;
}

describe('OptionsMenu (issue #894)', () => {
  function setup(active = 0) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.active = active;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const details = root.querySelector<HTMLDetailsElement>('details')!;
    const summary = root.querySelector<HTMLElement>('summary')!;
    return { fixture, root, details, summary };
  }

  it('is one button called Options, named for its list, closed at first', () => {
    const { summary, details } = setup();
    expect(summary.textContent!.trim()).toBe('Options');
    expect(summary.getAttribute('aria-label')).toBe('Options for Needs my attention');
    expect(details.open).toBe(false);
  });

  it('says how many choices are in force, as a number and in the accessible name', () => {
    const { summary, root } = setup(2);
    expect(summary.getAttribute('aria-label')).toBe('Options for Needs my attention, 2 in force');
    expect(root.querySelector('[data-options-count]')!.textContent!.trim()).toBe('2');
  });

  it('Escape closes it and puts the focus back on the button', () => {
    const { details, summary, root } = setup();
    details.open = true;
    root.querySelector<HTMLElement>('#plain')!.focus();
    root
      .querySelector('mf-options-menu')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('a click outside closes it, a click inside does not', () => {
    const { details, root } = setup();
    document.body.appendChild(root);
    details.open = true;
    root.querySelector<HTMLElement>('#plain')!.click();
    expect(details.open).toBe(true);
    root.querySelector<HTMLElement>('#outside')!.click();
    expect(details.open).toBe(false);
    root.remove();
  });

  it('an item marked data-options-pick closes it and returns the focus to the button', () => {
    const { details, summary, root } = setup();
    document.body.appendChild(root);
    details.open = true;
    root.querySelector<HTMLElement>('#pick')!.click();
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    root.remove();
  });
});
