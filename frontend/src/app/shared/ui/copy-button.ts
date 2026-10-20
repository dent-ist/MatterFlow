import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  input,
  output,
  signal,
} from '@angular/core';

/** Copy-to-clipboard button with an accessible "Copied" announcement (UX `mf-copy-button`). */
@Component({
  selector: 'mf-copy-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="mf-copy"
      [attr.aria-label]="'Copy ' + label()"
      [title]="'Copy ' + label()"
      [attr.tabindex]="rowStop() ? -1 : null"
      [attr.data-row-stop]="rowStop() ? '' : null"
      (click)="copy()"
      (keydown)="onKey($event)"
    >
      <i [class]="copied() ? 'pi pi-check' : 'pi pi-copy'" aria-hidden="true"></i>
      @if (showText()) {
        <span>{{ copied() ? doneCaption() : caption() }}</span>
      }
    </button>
    <span class="mf-sr-only" role="status" aria-live="polite">{{
      copied() ? doneCaption() : ''
    }}</span>
  `,
  styles: `
    .mf-copy {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: var(--mf-target-min);
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s2);
      border: 1px solid transparent;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-link);
      font: inherit;
      cursor: pointer;
    }
    .mf-copy .pi {
      font-size: var(--mf-fs-lg);
    }
    .mf-copy:hover {
      background: var(--mf-surface-alt);
    }
    /* In a list row (rowStop): out of the Tab order, shown on hover and while the row has focus, never moved (it keeps its space). */
    @media (hover: hover) and (min-width: 640px) {
      :host-context(tr:not(:hover):not(:focus-within)) .mf-copy[data-row-stop],
      :host-context(.rc:not(:hover):not(:focus-within)) .mf-copy[data-row-stop] {
        opacity: 0;
      }
    }
    .mf-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class CopyButton implements OnDestroy {
  /** Text placed on the clipboard. */
  readonly text = input.required<string>();
  /** Noun for the accessible name: "Copy <label>". */
  readonly label = input('to clipboard');
  readonly showText = input(false);
  /** The visible text with `showText` and the words announced once it is copied ("Copy link" / "Link copied"). Keep the caption inside the accessible name. */
  readonly caption = input('Copy');
  readonly doneCaption = input('Copied');
  /**
   * The button belongs to a list row (#282): it is not a Tab stop (`tabindex="-1"`, so 25 rows are 25 stops) but stays in the accessibility
   * tree, it is shown while the row is hovered or has focus (always on a phone), and the right arrow on the row's name link (`mfRowLink`)
   * steps to it. From the button, Tab goes on to what follows the row's link, Shift+Tab or the left arrow back to the link.
   */
  readonly rowStop = input(false);
  readonly copiedChange = output<string>();

  protected readonly copied = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Inside a row: Shift+Tab or the left arrow back to the name link; Tab on, from the link's place in the row. */
  protected onKey(event: KeyboardEvent): void {
    const back = event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey);
    if (!this.rowStop() || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key !== 'Tab' && !back) return;
    const link = (event.currentTarget as HTMLElement)
      .closest('tr, li')
      ?.querySelector<HTMLElement>('a[data-row-key]');
    if (!link) return;
    if (back) event.preventDefault();
    // Forward: focus moves to the link and the browser's own Tab then goes on from there, to the next stop after the link.
    link.focus();
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
    } catch {
      return; // clipboard blocked: leave the UI unchanged
    }
    this.copied.set(true);
    this.copiedChange.emit(this.text());
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 2000);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
