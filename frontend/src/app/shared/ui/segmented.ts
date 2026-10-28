import { Directive, ElementRef, OnDestroy, afterNextRender, inject } from '@angular/core';

/**
 * The one segmented toggle of the app (epic #893, issue #919): `mfSegmented` on the element that holds two to four buttons which are alternatives of one
 * thing (the scope, a range, a way to look at a list). The look is the global `.mf-seg` (same height as every control, the pressed button filled, bold and
 * ticked, never colour alone); this directive adds what a group of toggle buttons needs from the keyboard and a screen reader:
 *
 * - the group is named (`aria-label` on the element, set by the template), every button says whether it is pressed (`aria-pressed`);
 * - ONE Tab stop: only the pressed button is in the Tab order (the others have `tabindex="-1"`), so Tab goes into the group and out of it;
 * - the arrow keys (and Home / End) move the focus between the buttons; Space or Enter presses the focused one, as for any button.
 *
 * It is not a shortcut: the keys act only while the focus is inside the group (#420).
 *
 *   <div mfSegmented role="group" aria-label="Scope"> <button class="mf-btn" [attr.aria-pressed]="..."> ... </div>
 */
@Directive({
  selector: '[mfSegmented]',
  host: {
    class: 'mf-seg',
    '(keydown)': 'onKey($event)',
    '(focusin)': 'sync($event.target)',
  },
})
export class Segmented implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly watch: MutationObserver | null =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => this.sync(null));

  constructor() {
    afterNextRender(() => {
      this.sync(null);
      this.watch?.observe(this.el, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-pressed'],
      });
    });
  }

  ngOnDestroy(): void {
    this.watch?.disconnect();
  }

  private buttons(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>(':scope > button'));
  }

  /** The pressed button (or the focused one, or the first) is the Tab stop. */
  protected sync(focused: EventTarget | null): void {
    const all = this.buttons();
    if (all.length === 0) return;
    const stop =
      all.find((b) => b === focused) ??
      all.find((b) => b.getAttribute('aria-pressed') === 'true') ??
      all[0];
    for (const b of all) b.tabIndex = b === stop ? 0 : -1;
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const all = this.buttons();
    const at = all.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    let to = -1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        to = (at + 1) % all.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        to = (at - 1 + all.length) % all.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = all.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    all[to].focus();
  }
}
