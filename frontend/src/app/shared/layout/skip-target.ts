import { Injectable, signal, untracked } from '@angular/core';

/** The id the shell's page skip link points at unless a page names its own. */
export const DEFAULT_SKIP_ID = 'mf-list';

export interface SkipTargetDef {
  /** The link text ("Skip to task list"). */
  label: string;
  /** Moves focus to where the page's main content begins. */
  focus: () => void;
  /** The DOM id the link's `href` names (default `mf-list`): the element that holds the list. */
  id?: string;
  /**
   * The element that carries the id. Give your component's host (`inject(ElementRef).nativeElement`) and `register` sets the id and
   * `tabindex="-1"` on it while the target is current, so the link's `href` always names an element that exists. Without it the page's
   * own template must carry the id; the shell renders the link only while an element with that id is in the document.
   */
  element?: HTMLElement;
}

/**
 * A page's own first Tab stop (#181): the work pages offer "Skip to task list" ahead of "Skip to main content", and it moves focus to
 * the first row. The shell shows the link only while a page has registered a target and its element exists (#586).
 *
 * Usage for a page (the contract the Users, Assets, Admin, Search and Pod Work lists use):
 *   const off = inject(SkipTarget).register({ label: 'Skip to table', element: host, focus: () => firstRow()?.focus() });
 *   inject(DestroyRef).onDestroy(off);   // the link goes away with the page
 * Pass `id` only when the default `mf-list` would clash.
 */
@Injectable({ providedIn: 'root' })
export class SkipTarget {
  private readonly current = signal<SkipTargetDef | null>(null);
  readonly target = this.current.asReadonly();

  /** Offers the link until the returned function is called. */
  register(def: SkipTargetDef): () => void {
    // Read untracked: pages register from inside an effect, which must not depend on the signal it writes.
    const previous = untracked(() => this.current());
    if (previous && previous !== def) release(previous);
    claim(def);
    this.current.set(def);
    return () => {
      release(def);
      this.current.update((c) => (c === def ? null : c));
    };
  }
}

/** The id a definition names. */
export function skipId(def: SkipTargetDef): string {
  return def.id ?? DEFAULT_SKIP_ID;
}

/** The ids elements had before they became a target, so a test's root element gets its own id back. */
const ownIds = new WeakMap<HTMLElement, string>();

function claim(def: SkipTargetDef): void {
  if (!def.element) return;
  if (def.element.id && def.element.id !== skipId(def)) ownIds.set(def.element, def.element.id);
  def.element.id = skipId(def);
  def.element.setAttribute('tabindex', '-1');
}

function release(def: SkipTargetDef): void {
  const el = def.element;
  if (!el) return;
  if (el.id === skipId(def)) {
    const own = ownIds.get(el);
    if (own) el.id = own;
    else el.removeAttribute('id');
  }
  el.removeAttribute('tabindex');
}
