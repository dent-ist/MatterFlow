import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Arrow-key navigation over a visual grid of `[role="radio"]` (or `[role="option"]`) items, wherever they wrap or are split by headings.
 * Left/Right and Up/Down move focus to the neighbouring item by position, Home/End to the first/last. Enter and Space are left to the
 * items themselves (they are buttons). The owner keeps the roving `tabindex` (focus events tell it which item is current).
 */
@Directive({ selector: '[mfGridNav]', host: { '(keydown)': 'onKeydown($event)' } })
export class GridNav {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[role="radio"],[role="option"]'),
    ).filter((el) => !el.hasAttribute('disabled'));
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowRight':
        next = items[Math.min(current + 1, items.length - 1)];
        break;
      case 'ArrowLeft':
        next = items[Math.max(current - 1, 0)];
        break;
      case 'ArrowDown':
        next = this.vertical(items, current, 1);
        break;
      case 'ArrowUp':
        next = this.vertical(items, current, -1);
        break;
      case 'Home':
        next = items[0];
        break;
      case 'End':
        next = items[items.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  }

  /** The nearest item in the next row above/below, horizontally closest to the current one; stays put at the edge. */
  private vertical(items: HTMLElement[], current: number, direction: 1 | -1): HTMLElement {
    const from = items[current].getBoundingClientRect();
    const centre = from.left + from.width / 2;
    let best: HTMLElement | undefined;
    let bestRow = Infinity;
    let bestDx = Infinity;
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const rowDistance = direction === 1 ? r.top - from.top : from.top - r.top;
      if (rowDistance < from.height / 2) continue; // same row or the wrong direction
      const dx = Math.abs(r.left + r.width / 2 - centre);
      if (rowDistance < bestRow - 1 || (Math.abs(rowDistance - bestRow) <= 1 && dx < bestDx)) {
        best = el;
        bestRow = rowDistance;
        bestDx = dx;
      }
    }
    return best ?? items[current];
  }
}
