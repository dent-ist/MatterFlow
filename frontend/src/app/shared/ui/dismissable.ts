import {
  DestroyRef,
  afterNextRender,
  Directive,
  ElementRef,
  Injectable,
  inject,
  input,
  output,
} from '@angular/core';

/** One open popover, as the stack knows it. */
export interface PopoverEntry {
  /** The popover's own element. Clicks and focus inside it (and inside popovers opened from it) are not "outside". */
  panel: HTMLElement;
  /** The control that opened it: a click on it is not "outside" (its own handler toggles); Esc gives it focus back. */
  trigger: () => HTMLElement | null;
  /** A modal sheet owns its Esc (a filled text box takes the first one), outside clicks (its backdrop) and focus (its trap); only single-open and "popovers above it go first" apply. */
  modal?: () => boolean;
  /** Asks the owner to close. `returnFocus` is true for Esc only; the owner or `registerPopover` moves focus. */
  close: (returnFocus: boolean) => void;
}

/**
 * The one dismiss rule of every popover, disclosure panel and menu (My Work review X4, #140):
 *  - Esc closes the topmost open one and returns focus to its trigger; nothing else sees that Esc (a dialog, the drawer, a filled text
 *    filter keep theirs for the next press);
 *  - a pointer press or a focus move outside closes it without moving focus (a press on its trigger is left to the trigger, which toggles);
 *  - opening a popover closes the others, unless the new one sits inside the open one (a menu inside a panel); no focus return then.
 * The document listeners exist only while something is open.
 */
@Injectable({ providedIn: 'root' })
export class PopoverStack {
  private readonly stack: PopoverEntry[] = [];
  private listening = false;

  /** Adds an open popover; returns the function that removes it (call it when the popover goes away). */
  register(entry: PopoverEntry): () => void {
    for (const other of [...this.stack]) {
      if (!other.panel.contains(entry.panel) && !other.modal?.()) this.drop(other, false);
    }
    this.stack.push(entry);
    this.listen();
    return () => this.remove(entry);
  }

  /** Number of open popovers (tests). */
  get depth(): number {
    return this.stack.length;
  }

  private remove(entry: PopoverEntry): void {
    const i = this.stack.indexOf(entry);
    if (i >= 0) this.stack.splice(i, 1);
    if (this.stack.length === 0) this.unlisten();
  }

  private drop(entry: PopoverEntry, returnFocus: boolean): void {
    this.remove(entry);
    entry.close(returnFocus);
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    const top = this.stack[this.stack.length - 1];
    // A modal sheet on top handles its own Esc; a popover opened from inside it is on top of it and goes first.
    if (!top || top.modal?.()) return;
    event.stopPropagation();
    event.preventDefault();
    this.drop(top, true);
  };

  private readonly onOutside = (event: Event): void => {
    const target = event.target as Node | null;
    if (!target) return;
    // The deepest open popover that holds the target stays; everything opened after it closes.
    let keep = -1;
    this.stack.forEach((e, i) => {
      if (e.panel.contains(target) || e.trigger()?.contains(target)) keep = i;
    });
    for (const e of this.stack.slice(keep + 1).reverse()) {
      if (!e.modal?.()) this.drop(e, false);
    }
  };

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('keydown', this.onKeydown, true);
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('focusin', this.onOutside, true);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener('keydown', this.onKeydown, true);
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('focusin', this.onOutside, true);
  }
}

/**
 * Registers a popover for as long as the calling directive or component lives. Call it in a constructor or injection context; the
 * entry is removed when that context is destroyed. Esc moves focus to `trigger` before `close` runs (it may remove the trigger's
 * sibling, never the trigger itself).
 */
export function registerPopover(options: {
  panel: HTMLElement;
  trigger: () => HTMLElement | null;
  modal?: () => boolean;
  close: () => void;
}): void {
  const stack = inject(PopoverStack);
  let remove: (() => void) | null = null;
  let destroyed = false;
  // After the first render the panel is in the document, so "inside the open one" (a menu in a panel) can be told from "another popover".
  afterNextRender(() => {
    if (destroyed) return;
    remove = stack.register({
      panel: options.panel,
      trigger: options.trigger,
      modal: options.modal,
      close: (returnFocus) => {
        options.close();
        if (returnFocus) options.trigger()?.focus();
      },
    });
  });
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    remove?.();
  });
}

/**
 * Put it on a popover's panel element (rendered only while open, `@if (open()) { <div [mfDismissable]="btn" (dismissed)="...">}`).
 * The input is the trigger button (or null); `dismissed` fires on Esc, an outside press, an outside focus move or when another popover
 * opens. On Esc the trigger gets focus back.
 */
@Directive({ selector: '[mfDismissable]' })
export class Dismissable {
  /** The control that opened the panel. */
  readonly trigger = input<HTMLElement | null>(null, { alias: 'mfDismissable' });
  /** A modal panel (a sheet with its own backdrop, Esc and focus trap): single-open only. */
  readonly modal = input(false, { alias: 'mfDismissableModal' });
  readonly dismissed = output<void>();

  constructor() {
    registerPopover({
      panel: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
      trigger: () => this.trigger(),
      modal: () => this.modal(),
      close: () => this.dismissed.emit(),
    });
  }
}
