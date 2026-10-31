import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

let nextTipId = 0;

/**
 * A tooltip for hover AND keyboard focus (WCAG 1.4.13): `<button [mfTip]="'Upcoming events'">`. It shows after the pointer or focus arrives, stays while the pointer is over
 * the owner, and Esc hides it without moving focus. The tip is a fixed-position element on `body` (a scrolling frame cannot clip it) and the owner points at it with
 * `aria-describedby` while it is shown. Text only; the colours are the shared tokens. An empty text shows nothing.
 */
@Directive({
  selector: '[mfTip]',
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focus)': 'show()',
    '(blur)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class Tip {
  readonly text = input<string | null | undefined>(null, { alias: 'mfTip' });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private el: HTMLElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  show(): void {
    const text = this.text();
    if (!text || this.el) return;
    const tip = this.doc.createElement('div');
    tip.id = `mf-tip-${nextTipId++}`;
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    Object.assign(tip.style, {
      position: 'fixed',
      zIndex: '1200',
      maxWidth: '300px',
      padding: 'var(--mf-s2) var(--mf-s3)',
      borderRadius: 'var(--mf-radius-lg)',
      background: 'var(--mf-tip-bg)',
      color: 'var(--mf-tip-fg)',
      font: 'var(--mf-fs-sm) var(--mf-font)',
      lineHeight: '1.4',
      pointerEvents: 'none',
      boxShadow: 'var(--mf-shadow-pop)',
      whiteSpace: 'pre-line',
      visibility: 'hidden',
    });
    this.doc.body.appendChild(tip);
    const r = this.host.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = this.doc.defaultView?.innerWidth ?? 1024;
    // Prefer below the owner; to its left when it sits at the right edge (a rail), above when there is no room below.
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    let top = r.bottom + 6;
    if (r.right > vw - 80 && r.width < 80) {
      left = Math.max(8, r.left - w - 8);
      top = Math.max(8, r.top + r.height / 2 - h / 2);
    } else if (top + h > (this.doc.defaultView?.innerHeight ?? 768) - 8) {
      top = Math.max(8, r.top - h - 6);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = 'visible';
    this.host.setAttribute('aria-describedby', tip.id);
    this.el = tip;
  }

  hide(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.host.removeAttribute('aria-describedby');
  }
}
