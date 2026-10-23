import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  viewChild,
} from '@angular/core';

/** A piece of the query to mark: a `:NAME` placeholder (built-in or not) or the spot a problem was found at. */
export interface SqlMark {
  start: number;
  length: number;
  kind: 'param' | 'builtin' | 'error';
}

interface Segment {
  text: string;
  kind: SqlMark['kind'] | null;
}

/**
 * Cuts the text into plain and marked segments. Marks that overlap or run past the end are trimmed; an error mark wins over a placeholder
 * mark at the same spot. Pure, so the highlighter is easy to test.
 */
export function segmentsOf(text: string, marks: readonly SqlMark[]): Segment[] {
  const sorted = [...marks]
    .filter((m) => m.start >= 0 && m.start < text.length && m.length > 0)
    .sort((a, b) => a.start - b.start || (a.kind === 'error' ? -1 : 1));
  const out: Segment[] = [];
  let at = 0;
  for (const m of sorted) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start), kind: null });
    const end = Math.min(text.length, m.start + m.length);
    out.push({ text: text.slice(m.start, end), kind: m.kind });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: null });
  return out;
}

/** Number of lines of a text (an empty text has one). */
export function lineCount(text: string): number {
  return text.split('\n').length;
}

/**
 * The query editor (spec 9.2, 14): a plain textarea with line numbers and the `:NAME` placeholders and problem spots highlighted by a layer
 * behind the text. It is not a code editor and traps nothing: Tab moves focus out of it (no tab character is offered). The editor scrolls
 * inside its own box in both directions, so a long line never widens the page (phone). The layer behind the text is hidden from assistive
 * technology; the problems are listed as text next to the editor by the page.
 */
@Component({
  selector: 'mf-sql-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ed" [class.ed--error]="invalid()">
      <div #gutter class="ed__gutter" aria-hidden="true">
        @for (n of lines(); track n) {
          <div>{{ n }}</div>
        }
      </div>
      <div class="ed__stack">
        <pre
          #layer
          class="ed__layer"
          aria-hidden="true"
          data-highlight
        >@for (s of segments(); track $index) {@if (s.kind) {<mark class="ed__mark" [class]="'ed__mark ed__mark--' + s.kind">{{ s.text }}</mark>} @else {<span>{{ s.text }}</span>}}{{ '\\n' }}</pre>
        <textarea
          #area
          class="ed__text"
          wrap="off"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          [id]="inputId()"
          [attr.aria-label]="label()"
          [attr.aria-describedby]="describedBy() || null"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [value]="value()"
          (input)="onInput($event)"
          (scroll)="syncScroll()"
          data-sql
        ></textarea>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .ed {
      display: flex;
      box-sizing: border-box;
      height: var(--mf-editor-h, 22rem);
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-md);
      line-height: 1.5;
    }

    .ed:focus-within {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }

    .ed--error {
      border-color: var(--mf-danger);
    }

    .ed__gutter {
      flex: none;
      box-sizing: border-box;
      min-width: 3rem;
      padding: var(--mf-s2) var(--mf-s2) var(--mf-s2) var(--mf-s3);
      overflow: hidden;
      background: var(--mf-surface-alt);
      border-right: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
      text-align: right;
      user-select: none;
    }

    .ed__stack {
      position: relative;
      flex: 1;
      min-width: 0;
    }

    .ed__layer,
    .ed__text {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 0;
      font: inherit;
      line-height: inherit;
      letter-spacing: normal;
      tab-size: 4;
      white-space: pre;
      word-break: normal;
      overflow-wrap: normal;
    }

    .ed__layer {
      overflow: hidden;
      color: transparent;
      pointer-events: none;
    }

    .ed__text {
      overflow: auto;
      resize: none;
      background: transparent;
      color: var(--mf-text);
      caret-color: var(--mf-text);
    }

    .ed__text:focus {
      outline: none;
    }

    .ed__mark {
      border-radius: 2px;
      color: transparent;
    }

    .ed__mark--param {
      background: color-mix(in srgb, var(--mf-primary) 22%, transparent);
    }

    .ed__mark--builtin {
      background: color-mix(in srgb, var(--mf-info) 22%, transparent);
    }

    .ed__mark--error {
      background: color-mix(in srgb, var(--mf-danger) 25%, transparent);
      text-decoration: underline wavy var(--mf-danger);
    }
  `,
})
export class SqlEditor {
  readonly value = model('');
  readonly marks = input<readonly SqlMark[]>([]);
  readonly inputId = input('sql-editor');
  readonly label = input('Query');
  readonly invalid = input(false);
  /** Ids of the elements that describe the editor (the problem list). */
  readonly describedBy = input('');

  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');
  private readonly layer = viewChild.required<ElementRef<HTMLElement>>('layer');
  private readonly gutter = viewChild.required<ElementRef<HTMLElement>>('gutter');

  protected readonly lines = computed(() =>
    Array.from({ length: lineCount(this.value()) }, (_, i) => i + 1),
  );
  protected readonly segments = computed(() => segmentsOf(this.value(), this.marks()));

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLTextAreaElement).value);
    this.syncScroll();
  }

  protected syncScroll(): void {
    const area = this.area().nativeElement;
    this.layer().nativeElement.scrollTop = area.scrollTop;
    this.layer().nativeElement.scrollLeft = area.scrollLeft;
    this.gutter().nativeElement.scrollTop = area.scrollTop;
  }

  /** Moves focus into the editor. */
  focus(): void {
    this.area().nativeElement.focus();
  }

  /** Puts the cursor at a 1-based line and column and scrolls it into view (a problem in the list was chosen). */
  goTo(line: number, column: number): void {
    const area = this.area().nativeElement;
    const lines = this.value().split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length - 1); i++) offset += lines[i].length + 1;
    offset += Math.max(0, column - 1);
    area.focus();
    area.setSelectionRange(offset, offset);
    const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20;
    area.scrollTop = Math.max(0, (line - 3) * lineHeight);
    this.syncScroll();
  }

  /** Inserts text at the cursor (the schema browser), replacing the selection, and keeps focus in the editor. */
  insertAtCursor(text: string): void {
    const area = this.area().nativeElement;
    const start = area.selectionStart ?? this.value().length;
    const end = area.selectionEnd ?? start;
    const next = this.value().slice(0, start) + text + this.value().slice(end);
    this.value.set(next);
    area.value = next;
    const at = start + text.length;
    area.focus();
    area.setSelectionRange(at, at);
    this.syncScroll();
  }
}
