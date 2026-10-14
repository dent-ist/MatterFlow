import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  SecurityContext,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { COMMENT_MAX_TEXT, htmlToText, normalizeLink } from './rich-text';

type Command = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList';

/**
 * A small rich-text editor for Task comments (UX 5.5): bold, italic, bulleted and numbered lists, and links. No library: a contenteditable
 * area with the browser's own commands, so it adds nothing to the bundle. Paste is reduced to plain text. The HTML it produces is only a
 * draft; the server sanitizes it again and the UI renders the sanitized result.
 *
 * Inputs: `value` (HTML, two-way), `maxLength` (plain-text characters), `label` (accessible name), `placeholder`, `disabled`.
 * Output: `submitted` (Ctrl+Enter).
 */
@Component({
  selector: 'mf-rich-text-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rte" [class.rte--disabled]="disabled()" [class.rte--invalid]="tooLong()">
      <div class="rte__bar" role="toolbar" aria-label="Formatting">
        @for (b of buttons; track b.command) {
          <button
            type="button"
            class="rte__btn"
            [attr.data-cmd]="b.command"
            [attr.aria-label]="b.label"
            [attr.aria-pressed]="active().has(b.command)"
            [title]="b.label"
            [disabled]="disabled()"
            (mousedown)="$event.preventDefault()"
            (click)="run(b.command)"
          >
            <i [class]="'pi ' + b.icon" aria-hidden="true"></i>
          </button>
        }
        <button
          type="button"
          class="rte__btn"
          data-cmd="link"
          aria-label="Link"
          title="Link"
          [attr.aria-expanded]="linkOpen()"
          [disabled]="disabled()"
          (mousedown)="$event.preventDefault()"
          (click)="openLink()"
        >
          <i class="pi pi-link" aria-hidden="true"></i>
        </button>
      </div>

      @if (linkOpen()) {
        <form class="rte__link" data-link-form (submit)="applyLink($event)">
          <label class="rte__link-label" [for]="linkId">Link address</label>
          <input
            #linkInput
            class="rte__link-input"
            type="text"
            inputmode="url"
            autocomplete="off"
            placeholder="https://example.com or mailto:name@example.com"
            [id]="linkId"
            [value]="linkText()"
            [attr.aria-invalid]="linkError() ? 'true' : null"
            [attr.aria-describedby]="linkError() ? linkId + '-error' : null"
            (input)="linkText.set($any($event.target).value); linkError.set(false)"
            (keydown.escape)="closeLink()"
          />
          <button type="submit" class="rte__small">Add link</button>
          <button type="button" class="rte__small" (click)="closeLink()">Cancel</button>
          @if (linkError()) {
            <span class="rte__error" role="alert" [id]="linkId + '-error'" data-link-error
              >That address can't be used as a link. Use one that starts with http://, https:// or
              mailto:, or a web address such as example.com.</span
            >
          }
        </form>
      }

      <div
        #area
        class="rte__area"
        role="textbox"
        tabindex="0"
        aria-multiline="true"
        [attr.aria-label]="label()"
        [attr.data-placeholder]="placeholder()"
        [attr.contenteditable]="disabled() ? 'false' : 'true'"
        [class.rte__area--empty]="empty()"
        (input)="onInput()"
        (keyup)="refreshActive()"
        (mouseup)="refreshActive()"
        (paste)="onPaste($event)"
        (keydown)="onKey($event)"
      ></div>

      <div class="rte__foot">
        <span class="rte__count" [class.rte__count--over]="tooLong()" aria-live="polite">
          @if (showCount()) {
            {{ length() }} / {{ maxLength() }}
          }
        </span>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .rte {
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .rte:focus-within {
      outline: 2px solid var(--mf-focus, var(--mf-link));
      outline-offset: 1px;
    }
    .rte--invalid {
      border-color: var(--mf-danger);
    }
    .rte__bar {
      display: flex;
      gap: var(--mf-s1);
      padding: var(--mf-s1) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
    }
    .rte__btn {
      min-width: 2rem;
      min-height: 2rem;
      border: 1px solid transparent;
      border-radius: var(--mf-radius);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .rte__btn:hover:not(:disabled),
    .rte__btn[aria-pressed='true'] {
      background: var(--mf-selected-bg);
    }
    .rte__btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .rte__link {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
    }
    .rte__link-label {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .rte__link-input {
      flex: 1 1 14rem;
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .rte__small {
      min-height: 2rem;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .rte__error {
      flex-basis: 100%;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .rte__area {
      position: relative;
      min-height: 6rem;
      max-height: 20rem;
      overflow: auto;
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-text);
      outline: none;
      overflow-wrap: anywhere;
    }
    .rte__area--empty::before {
      content: attr(data-placeholder);
      color: var(--mf-text-muted);
      pointer-events: none;
      position: absolute;
    }
    .rte__area p {
      margin: 0 0 var(--mf-s2);
    }
    .rte__area ul,
    .rte__area ol {
      margin: 0 0 var(--mf-s2);
      padding-left: var(--mf-s5, 1.5rem);
    }
    .rte__area a {
      color: var(--mf-link);
    }
    .rte__foot {
      display: flex;
      justify-content: flex-end;
      padding: 0 var(--mf-s3) var(--mf-s1);
      min-height: 1.25rem;
    }
    .rte__count {
      font-size: var(--mf-fs-xs);
      color: var(--mf-text-muted);
    }
    .rte__count--over {
      color: var(--mf-danger);
    }
  `,
})
export class RichTextEditor {
  /** The comment as HTML (two-way). */
  readonly value = model('');
  /** Plain-text character limit; the counter appears near it. */
  readonly maxLength = input(COMMENT_MAX_TEXT);
  readonly label = input('Comment');
  readonly placeholder = input('Add a comment...');
  readonly disabled = input(false);
  /** Ctrl+Enter pressed inside the editor. */
  readonly submitted = output<void>();

  protected readonly buttons: readonly { command: Command; label: string; icon: string }[] = [
    { command: 'bold', label: 'Bold', icon: 'pi-bold' },
    { command: 'italic', label: 'Italic', icon: 'pi-italic' },
    { command: 'insertUnorderedList', label: 'Bulleted list', icon: 'pi-list' },
    { command: 'insertOrderedList', label: 'Numbered list', icon: 'pi-sort-numeric-down' },
  ];

  private readonly sanitizer = inject(DomSanitizer);
  private readonly area = viewChild.required<ElementRef<HTMLElement>>('area');
  private readonly linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');

  protected readonly linkId = `mf-rte-link-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly active = signal<ReadonlySet<Command>>(new Set());
  protected readonly linkOpen = signal(false);
  protected readonly linkText = signal('');
  protected readonly linkError = signal(false);
  protected readonly length = signal(0);
  protected readonly empty = computed(() => this.length() === 0);
  protected readonly tooLong = computed(() => this.length() > this.maxLength());
  protected readonly showCount = computed(
    () => this.length() >= this.maxLength() * 0.8 || this.tooLong(),
  );

  private savedRange: Range | null = null;
  /** The last HTML this editor itself produced, so an echo of it from the parent does not reset the caret. */
  private lastEmitted: string | null = null;

  constructor() {
    // Push outside changes (clear after posting, an edit's starting text) into the editable area.
    effect(() => {
      const html = this.value();
      untracked(() => {
        if (html === this.lastEmitted) return;
        this.lastEmitted = html;
        this.area().nativeElement.innerHTML =
          this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
        this.length.set(this.textLength());
      });
    });
    effect(() => {
      if (this.linkOpen()) queueMicrotask(() => this.linkInput()?.nativeElement.focus());
    });
  }

  /** Moves the caret into the editor. */
  focus(): void {
    this.area().nativeElement.focus();
  }

  protected run(command: Command): void {
    this.area().nativeElement.focus();
    this.exec(command);
    this.onInput();
  }

  protected openLink(): void {
    const selection = document.getSelection();
    const inside =
      selection &&
      selection.rangeCount > 0 &&
      this.area().nativeElement.contains(selection.anchorNode);
    this.savedRange = inside ? selection.getRangeAt(0).cloneRange() : null;
    this.linkText.set('');
    this.linkError.set(false);
    this.linkOpen.set(true);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.area().nativeElement.focus();
  }

  protected applyLink(event: Event): void {
    event.preventDefault();
    const url = normalizeLink(this.linkText());
    if (!url) {
      this.linkError.set(true);
      return;
    }
    const area = this.area().nativeElement;
    area.focus();
    const selection = document.getSelection();
    if (this.savedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(this.savedRange);
    }
    const hasSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
    if (hasSelection) {
      this.exec('createLink', url);
    } else {
      // Nothing selected: insert the address itself as the link text, set off by spaces so it does not run into the words around it
      // ("run QChttps://..." in UAT2-11) and the caret can carry on typing after it.
      this.exec(
        'insertHTML',
        `${leadingSpace(this.savedRange)}<a href="${escapeAttribute(url)}">${escapeText(url)}</a>&nbsp;`,
      );
    }
    this.linkOpen.set(false);
    this.onInput();
  }

  protected onInput(): void {
    const html = this.area().nativeElement.innerHTML;
    this.length.set(this.textLength());
    this.lastEmitted = this.empty() ? '' : html;
    this.value.set(this.lastEmitted);
    this.refreshActive();
  }

  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text.length > 0) {
      this.exec('insertText', text);
      this.onInput();
    }
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submitted.emit();
    }
  }

  protected refreshActive(): void {
    const next = new Set<Command>();
    for (const b of this.buttons) {
      try {
        if (
          typeof document.queryCommandState === 'function' &&
          document.queryCommandState(b.command)
        ) {
          next.add(b.command);
        }
      } catch {
        // queryCommandState can throw when the editor has no selection; the button then shows as not pressed.
      }
    }
    this.active.set(next);
  }

  private textLength(): number {
    return htmlToText(this.area().nativeElement.innerHTML).trim().length;
  }

  private exec(command: string, argument?: string): void {
    if (typeof document.execCommand === 'function') document.execCommand(command, false, argument);
  }
}

/** A space to put before an inserted link when the text just before the caret does not already end in one. */
export function leadingSpace(range: Range | null): string {
  if (!range || !range.collapsed) return '';
  const node = range.startContainer;
  const before =
    node.nodeType === Node.TEXT_NODE && range.startOffset > 0
      ? (node.textContent ?? '').charAt(range.startOffset - 1)
      : '';
  return before !== '' && !/\s/.test(before) ? '&nbsp;' : '';
}

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, '&quot;');
