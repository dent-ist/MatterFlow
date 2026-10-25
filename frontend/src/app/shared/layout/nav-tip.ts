import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, Renderer2, inject } from '@angular/core';

/** The 56 px icon rail: from 640 px (below it the menu is a panel with visible names) up to the width where names are drawn again. */
const RAIL_QUERY = '(min-width: 640px) and (max-width: 1099px)';
/** A touch must be held this long to show the name (and then it does not follow the link). */
export const LONG_PRESS_MS = 450;
/** How long the name of a long press stays on screen after the finger lifts. */
export const TOUCH_HIDE_MS = 1800;

/**
 * Names for the icon rail (S7, #623). In the 56 px rail the link text is for screen readers only, so a small tip shows the name of the
 * link next to its icon on hover, on keyboard focus (`:focus-visible`) and on a long press with a finger. Esc dismisses it without moving
 * focus or the pointer (WCAG 1.4.13); it comes back when the pointer or focus moves to another item. The tip is a fixed-position element
 * outside the scrolling `<nav>` (a child of it would be clipped), `aria-hidden` because the links already carry their names.
 *
 * Put it on the `<nav>`; every link or button that should show a name carries `data-tip="Name"`. Nothing happens outside the rail.
 */
@Directive({
  selector: '[mfNavTip]',
  host: {
    '(focusin)': 'onFocus($event)',
    '(focusout)': 'hide(true)',
    '(mouseover)': 'onHover($event)',
    '(mouseleave)': 'hide(true)',
    '(keydown.escape)': 'dismiss()',
    '(pointerdown)': 'onDown($event)',
    '(pointerup)': 'onUp()',
    '(pointercancel)': 'onUp()',
    '(contextmenu)': 'onContextMenu($event)',
  },
})
export class NavTip {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private readonly renderer = inject(Renderer2);
  private tip: HTMLElement | null = null;
  private current: HTMLElement | null = null;
  /** The item whose tip Esc dismissed: it stays quiet until the pointer or focus leaves it. */
  private dismissed: HTMLElement | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private longPressed = false;

  constructor() {
    // A long press must not also follow the link when the finger lifts: swallow that one click before the router sees it.
    const swallow = (event: Event): void => {
      if (!this.longPressed) return;
      this.longPressed = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.host.addEventListener('click', swallow, true);
    inject(DestroyRef).onDestroy(() => {
      this.host.removeEventListener('click', swallow, true);
      clearTimeout(this.pressTimer);
      clearTimeout(this.hideTimer);
      this.remove();
    });
  }

  private inRail(): boolean {
    return typeof matchMedia === 'function' && matchMedia(RAIL_QUERY).matches;
  }

  private itemOf(event: Event): HTMLElement | null {
    const target = event.target;
    return target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
  }

  protected onFocus(event: FocusEvent): void {
    const item = this.itemOf(event);
    // Only keyboard focus: a mouse click that focuses the link must not leave a tip behind.
    if (item && item.matches(':focus-visible')) this.show(item);
  }

  protected onHover(event: MouseEvent): void {
    const item = this.itemOf(event);
    if (item) this.show(item);
    else this.hide(true);
  }

  protected onDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    const item = this.itemOf(event);
    this.longPressed = false;
    clearTimeout(this.pressTimer);
    clearTimeout(this.hideTimer);
    if (!item) return;
    this.pressTimer = setTimeout(() => {
      this.longPressed = true;
      this.show(item);
    }, LONG_PRESS_MS);
  }

  protected onUp(): void {
    clearTimeout(this.pressTimer);
    if (this.longPressed) {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => this.hide(true), TOUCH_HIDE_MS);
    }
  }

  protected onContextMenu(event: Event): void {
    // The long-press menu of the browser would cover the name.
    if (this.longPressed) event.preventDefault();
  }

  protected dismiss(): void {
    if (!this.current) return;
    this.dismissed = this.current;
    this.remove();
  }

  protected hide(forget: boolean): void {
    this.remove();
    if (forget) this.dismissed = null;
  }

  private show(item: HTMLElement): void {
    if (!this.inRail() || item === this.dismissed) return;
    if (this.current === item && this.tip) return;
    this.remove();
    const text = item.getAttribute('data-tip');
    if (!text) return;
    const rect = item.getBoundingClientRect();
    const tip = this.renderer.createElement('div') as HTMLElement;
    tip.setAttribute('aria-hidden', 'true');
    tip.setAttribute('data-nav-tip', '');
    tip.textContent = text;
    Object.assign(tip.style, {
      position: 'fixed',
      top: `${rect.top + rect.height / 2}px`,
      left: `${rect.right + 6}px`,
      transform: 'translateY(-50%)',
      zIndex: '1100',
      maxWidth: '16rem',
      padding: '4px 8px',
      borderRadius: 'var(--mf-radius)',
      background: 'var(--mf-text)',
      color: 'var(--mf-surface)',
      fontSize: 'var(--mf-fs-sm)',
      lineHeight: '1.3',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      boxShadow: 'var(--mf-shadow-2)',
    });
    this.renderer.appendChild(this.doc.body, tip);
    this.tip = tip;
    this.current = item;
  }

  private remove(): void {
    this.tip?.remove();
    this.tip = null;
    this.current = null;
  }
}
