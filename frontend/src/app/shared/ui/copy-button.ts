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
      (click)="copy()"
    >
      <i [class]="copied() ? 'pi pi-check' : 'pi pi-copy'" aria-hidden="true"></i>
      @if (showText()) {
        <span>{{ copied() ? 'Copied' : 'Copy' }}</span>
      }
    </button>
    <span class="mf-sr-only" role="status" aria-live="polite">{{ copied() ? 'Copied' : '' }}</span>
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
    .mf-copy:hover {
      background: var(--mf-surface-alt);
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
  readonly copiedChange = output<string>();

  protected readonly copied = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

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
