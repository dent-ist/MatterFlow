import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Dropdown, DropdownItem } from '../../shared/ui/dropdown';
import { AnyExtension, Editor, Extension, Node } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';

/** The kinds of thing a note can refer to; `embed` shows another note inline. */
export type RefKind = 'asset' | 'project' | 'matter' | 'note' | 'user' | 'embed';

/** The one data attribute each kind carries in the stored html (the server allows exactly these, one per span). */
export const REF_ATTRIBUTE: Record<RefKind, string> = {
  asset: 'data-asset-id',
  project: 'data-project-id',
  matter: 'data-matter-id',
  note: 'data-note-id',
  user: 'data-user-id',
  embed: 'data-embed-id',
};

/** What the person sees before the label: `@` for a person, `#` for an asset. */
const REF_PREFIX: Record<RefKind, string> = {
  asset: '#',
  project: '',
  matter: '',
  note: '',
  user: '@',
  embed: '',
};

export interface SuggestItem {
  kind: RefKind | 'command';
  id: number;
  label: string;
  sub?: string;
  /** For a command: its word (`asset`, `mention`, ...). */
  command?: string;
}

/** The slash commands of the owner's list (no /assets, no /template, no /task). */
export const SLASH_COMMANDS: readonly {
  command: string;
  label: string;
  sub: string;
  kind: RefKind;
}[] = [
  {
    command: 'asset',
    label: 'Asset',
    sub: 'Reference an asset of this matter (shortcut: #)',
    kind: 'asset',
  },
  { command: 'mention', label: 'Mention', sub: 'Mention a person (shortcut: @)', kind: 'user' },
  {
    command: 'project',
    label: 'Project',
    sub: 'Reference a project of this matter',
    kind: 'project',
  },
  { command: 'matter', label: 'Matter', sub: 'Reference a matter you can see', kind: 'matter' },
  {
    command: 'note',
    label: 'Note',
    sub: 'Show another note of this matter inline, read only',
    kind: 'embed',
  },
];

/** Where the menu gets its rows: the host searches the API. */
export type SuggestSource = (kind: RefKind, query: string) => Promise<SuggestItem[]>;

interface MenuState {
  items: SuggestItem[];
  index: number;
  left: number;
  top: number;
  label: string;
  pick: (item: SuggestItem) => void;
}

/** The text of another note for the inline `/note` block: its title and sanitised html (the host fetches it with the viewer's own permissions). */
export interface EmbedContent {
  title: string;
  html: string;
}

export type EmbedSource = (noteId: number) => Promise<EmbedContent | null>;

/** The schema of a note without the typing triggers: used by the editor and by the read-only copies that show a linked note. */
function baseExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    referenceNode(),
  ];
}

function referenceNode(): Node {
  return Node.create({
    name: 'ref',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { kind: { default: 'asset' }, refId: { default: 0 }, label: { default: '' } };
    },
    parseHTML() {
      return (Object.keys(REF_ATTRIBUTE) as RefKind[])
        .filter((k) => k !== 'embed')
        .map((kind) => ({
          tag: `span[${REF_ATTRIBUTE[kind]}]`,
          getAttrs: (el: HTMLElement | string) => {
            if (typeof el === 'string') return false;
            const id = Number(el.getAttribute(REF_ATTRIBUTE[kind]));
            return Number.isInteger(id) && id > 0
              ? { kind, refId: id, label: el.textContent ?? '' }
              : false;
          },
        }));
    },
    renderHTML({ node }) {
      const kind = node.attrs['kind'] as RefKind;
      return [
        'span',
        { [REF_ATTRIBUTE[kind]]: String(node.attrs['refId']) },
        node.attrs['label'] as string,
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span');
        const kind = node.attrs['kind'] as RefKind;
        dom.setAttribute(REF_ATTRIBUTE[kind], String(node.attrs['refId']));
        dom.setAttribute('contenteditable', 'false');
        dom.className = `ne-ref ne-ref--${kind}`;
        dom.textContent = node.attrs['label'] as string;
        return { dom };
      };
    },
  });
}

/** Another note shown inline and read only, with a border. Stored as `<span data-embed-id="n">Title</span>` inside a paragraph. */
function embedNode(source: () => EmbedSource | null): Node {
  return Node.create({
    name: 'noteEmbed',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { refId: { default: 0 }, label: { default: '' } };
    },
    parseHTML() {
      return [
        {
          tag: `span[${REF_ATTRIBUTE.embed}]`,
          getAttrs: (el: HTMLElement | string) => {
            if (typeof el === 'string') return false;
            const id = Number(el.getAttribute(REF_ATTRIBUTE.embed));
            return Number.isInteger(id) && id > 0
              ? { refId: id, label: el.textContent ?? '' }
              : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return [
        'span',
        { [REF_ATTRIBUTE.embed]: String(node.attrs['refId']) },
        node.attrs['label'] as string,
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span');
        dom.setAttribute('contenteditable', 'false');
        dom.className = 'ne-embed';
        dom.dataset['embedNote'] = String(node.attrs['refId']);
        const title = document.createElement('span');
        title.className = 'ne-embed__title';
        title.textContent = node.attrs['label'] as string;
        const body = document.createElement('span');
        body.className = 'ne-embed__body';
        dom.append(title, body);
        let inner: Editor | null = null;
        let gone = false;
        // The linked note is shown through the same schema as the editor (read only), never as raw html.
        void source()?.(node.attrs['refId'] as number).then((content) => {
          if (gone) return;
          if (!content) {
            title.textContent = 'This note is not available to you';
            return;
          }
          title.textContent = content.title;
          inner = new Editor({
            element: body,
            content: content.html,
            editable: false,
            extensions: [...baseExtensions()],
          });
        });
        return {
          dom,
          destroy: () => {
            gone = true;
            inner?.destroy();
          },
        };
      };
    },
  });
}

/**
 * The rich-text editor of a note (epic #1001, MD-13 and MD-14): TipTap (ProseMirror) with the toolbar of the mockup (paragraph style, bold, italic, underline,
 * bullets, numbers, quote, link, table with its tools, `@`, `#`, clear formatting, undo, redo) and the typing triggers `@` (a person), `#` (an asset) and `/`
 * (the commands /asset, /mention, /project, /matter, /note). These are keys of the widget, not app shortcuts (#420): they act only while the text field has focus.
 *
 * The editor is the only place the html of a note is parsed on the client; the server sanitises what it stores (allow-list, one reference span with one data
 * attribute) and what comes back is shown again through this schema, so unknown markup is dropped here as well. Load it lazily (`@defer`): it carries ProseMirror.
 */
@Component({
  selector: 'mf-note-editor',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: `
    .ne {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    .ne__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1);
      padding: var(--mf-s1) 0 var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
    }
    .ne__sep {
      width: 1px;
      align-self: stretch;
      margin: 0 var(--mf-s1);
      background: var(--mf-border);
    }
    .ne__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--mf-ctl-h);
      height: var(--mf-ctl-h);
      padding: 0 var(--mf-s2);
      border: 1px solid transparent;
      border-radius: var(--mf-radius-md);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .ne__btn:hover:not(:disabled) {
      background: var(--mf-surface-2, var(--mf-sem-neutral-bg));
    }
    .ne__btn[aria-pressed='true'] {
      background: var(--mf-sem-info-bg, var(--mf-sem-neutral-bg));
      color: var(--mf-sem-info-fg, var(--mf-text));
      font-weight: 700;
    }
    .ne__btn:disabled {
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .ne__select {
      height: var(--mf-ctl-h);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .ne__tablebar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1);
      padding: var(--mf-s1) var(--mf-s2);
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface-2, var(--mf-sem-neutral-bg));
    }
    .ne__pop {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface);
    }
    .ne__num {
      width: 4.5rem;
      height: var(--mf-ctl-h);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .ne__area {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: var(--mf-s3) var(--mf-s1);
    }
    .ne__area .ProseMirror {
      min-height: 100%;
      outline: none;
      overflow-wrap: anywhere;
    }
    .ne__area .ProseMirror:focus-visible,
    .ne__area .ProseMirror:focus {
      outline: 2px solid var(--mf-focus, var(--mf-primary));
      outline-offset: 4px;
    }
    .ne__area .ProseMirror > :first-child {
      font-size: var(--mf-fs-xl, 1.5rem);
      font-weight: 700;
      line-height: 1.25;
    }
    .ne__area .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left;
      height: 0;
      color: var(--mf-text-muted);
      pointer-events: none;
    }
    .ne__area .ProseMirror table {
      border-collapse: collapse;
      width: 100%;
      margin: var(--mf-s2) 0;
    }
    .ne__area .ProseMirror th,
    .ne__area .ProseMirror td {
      min-width: 4rem;
      padding: var(--mf-s1) var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      vertical-align: top;
    }
    .ne__area .ProseMirror th {
      background: var(--mf-surface-2, var(--mf-sem-neutral-bg));
      text-align: start;
    }
    .ne__area .ProseMirror td > p,
    .ne__area .ProseMirror th > p {
      margin: 0;
      font-size: inherit;
      font-weight: inherit;
    }
    .ne__area .ProseMirror blockquote {
      margin: var(--mf-s2) 0;
      padding-inline-start: var(--mf-s3);
      border-inline-start: 3px solid var(--mf-border-strong);
      color: var(--mf-text-muted);
    }
    .ne__area .ProseMirror a {
      color: var(--mf-link, var(--mf-primary));
      text-decoration: underline;
    }
    .ne-ref {
      display: inline-block;
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-info-bg, var(--mf-sem-neutral-bg));
      color: var(--mf-sem-info-fg, var(--mf-text));
      font-weight: 600;
      white-space: nowrap;
    }
    .ne-embed__title {
      display: block;
      margin-bottom: var(--mf-s1);
      font-weight: 700;
    }
    .ne-embed__body {
      display: block;
      font-weight: 400;
    }
    .ne-embed {
      display: block;
      margin: var(--mf-s2) 0;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface-2, var(--mf-sem-neutral-bg));
      font-weight: 600;
    }
    .ne__menu {
      position: fixed;
      z-index: 1100;
      min-width: 16rem;
      max-width: min(26rem, 94vw);
      max-height: 16rem;
      margin: 0;
      padding: var(--mf-s1);
      overflow-y: auto;
      list-style: none;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-md);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-pop);
    }
    .ne__menu li {
      display: flex;
      flex-direction: column;
      padding: var(--mf-s1) var(--mf-s2);
      border-radius: var(--mf-radius-sm, 4px);
      cursor: pointer;
    }
    .ne__menu li[aria-selected='true'] {
      background: var(--mf-sem-info-bg, var(--mf-sem-neutral-bg));
    }
    .ne__menu small {
      color: var(--mf-text-muted);
    }
  `,
  template: `
    <div class="ne" data-note-editor>
      @if (editable()) {
        <div class="ne__bar" role="toolbar" aria-label="Text formatting" data-editor-toolbar>
          <mf-dropdown
            buttonId="ne-style"
            label="Paragraph style"
            size="sm"
            [items]="styleItems"
            [value]="style()"
            (valueChange)="setStyle($event)"
          />
          <button
            type="button"
            class="ne__btn"
            aria-label="Bold"
            title="Bold"
            [attr.aria-pressed]="active('bold')"
            (click)="run('toggleBold')"
          >
            <b>B</b>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Italic"
            title="Italic"
            [attr.aria-pressed]="active('italic')"
            (click)="run('toggleItalic')"
          >
            <i>I</i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Underline"
            title="Underline"
            [attr.aria-pressed]="active('underline')"
            (click)="run('toggleUnderline')"
          >
            <u>U</u>
          </button>
          <span class="ne__sep" aria-hidden="true"></span>
          <button
            type="button"
            class="ne__btn"
            aria-label="Bulleted list"
            title="Bulleted list"
            [attr.aria-pressed]="active('bulletList')"
            (click)="run('toggleBulletList')"
          >
            <i class="pi pi-list" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Numbered list"
            title="Numbered list"
            [attr.aria-pressed]="active('orderedList')"
            (click)="run('toggleOrderedList')"
          >
            <i class="pi pi-sort-numeric-down" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Quote"
            title="Quote"
            [attr.aria-pressed]="active('blockquote')"
            (click)="run('toggleBlockquote')"
          >
            <i class="pi pi-comment" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Link"
            title="Link"
            [attr.aria-pressed]="active('link')"
            (click)="linkOpen.set(!linkOpen())"
          >
            <i class="pi pi-link" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Table"
            title="Table"
            [attr.aria-expanded]="tableOpen()"
            (click)="tableOpen.set(!tableOpen())"
          >
            <i class="pi pi-table" aria-hidden="true"></i>
          </button>
          <span class="ne__sep" aria-hidden="true"></span>
          <button
            type="button"
            class="ne__btn"
            aria-label="Mention a person"
            title="Mention a person (@)"
            data-insert-mention
            (click)="trigger('@')"
          >
            &#64;
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Reference an asset"
            title="Reference an asset (#)"
            data-insert-asset
            (click)="trigger('#')"
          >
            #
          </button>
          <span class="ne__sep" aria-hidden="true"></span>
          <button
            type="button"
            class="ne__btn"
            aria-label="Clear formatting"
            title="Clear formatting"
            (click)="clearFormatting()"
          >
            <i class="pi pi-eraser" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Undo"
            title="Undo"
            (click)="run('undo')"
          >
            <i class="pi pi-undo" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ne__btn"
            aria-label="Redo"
            title="Redo"
            (click)="run('redo')"
          >
            <i class="pi pi-refresh" aria-hidden="true"></i>
          </button>
        </div>
        @if (linkOpen()) {
          <div class="ne__pop" role="group" aria-label="Link">
            <label for="ne-link">Address</label>
            <input
              id="ne-link"
              #linkInput
              type="url"
              class="ne__num"
              style="width: 18rem"
              placeholder="https://"
              [value]="linkUrl()"
              (input)="linkUrl.set($any($event.target).value)"
            />
            <button type="button" class="ne__btn" data-link-apply (click)="applyLink()">
              Apply
            </button>
            <button type="button" class="ne__btn" (click)="removeLink()">Remove link</button>
          </div>
        }
        @if (tableOpen()) {
          <div class="ne__pop" role="group" aria-label="Insert a table">
            <label for="ne-rows">Rows</label>
            <input
              id="ne-rows"
              type="number"
              min="1"
              max="20"
              class="ne__num"
              [value]="rows()"
              (input)="rows.set(+$any($event.target).value || 1)"
            />
            <label for="ne-cols">Columns</label>
            <input
              id="ne-cols"
              type="number"
              min="1"
              max="10"
              class="ne__num"
              [value]="cols()"
              (input)="cols.set(+$any($event.target).value || 1)"
            />
            <label
              ><input
                type="checkbox"
                [checked]="headerRow()"
                (change)="headerRow.set($any($event.target).checked)"
              />
              Header row</label
            >
            <button type="button" class="ne__btn" data-table-insert (click)="insertTable()">
              Insert table
            </button>
          </div>
        }
        @if (inTable()) {
          <div class="ne__tablebar" role="toolbar" aria-label="Table tools" data-table-tools>
            <button type="button" class="ne__btn" (click)="run('addRowAfter')">Add row</button>
            <button type="button" class="ne__btn" (click)="run('deleteRow')">Remove row</button>
            <button type="button" class="ne__btn" (click)="run('addColumnAfter')">
              Add column
            </button>
            <button type="button" class="ne__btn" (click)="run('deleteColumn')">
              Remove column
            </button>
            <button type="button" class="ne__btn" (click)="run('toggleHeaderRow')">
              Header row
            </button>
            <button type="button" class="ne__btn" (click)="run('deleteTable')">Delete table</button>
          </div>
        }
      }
      <div class="ne__area" #host data-editor-area></div>
      @if (menu(); as m) {
        <ul
          class="ne__menu"
          role="listbox"
          [attr.aria-label]="m.label"
          [style.left.px]="m.left"
          [style.top.px]="m.top"
          data-suggest-menu
        >
          @for (item of m.items; track $index) {
            <li
              role="option"
              [attr.aria-selected]="$index === m.index"
              (mousedown)="$event.preventDefault(); m.pick(item)"
            >
              {{ item.label }}
              @if (item.sub) {
                <small>{{ item.sub }}</small>
              }
            </li>
          } @empty {
            <li role="option" aria-disabled="true" aria-selected="false">
              <small>Nothing found</small>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class NoteEditor {
  private readonly hostEl = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor: Editor | null = null;

  /** The html to start from. A different `contentKey` loads it again (a different note); typing never reads it back. */
  readonly html = input('');
  readonly contentKey = input<unknown>(null);
  readonly editable = input(false);
  readonly placeholder = input('Untitled note');
  /** Searches the API for the menu (people, assets, projects, matters, notes). Without it the triggers do nothing. */
  readonly source = input<SuggestSource | null>(null);
  /** Fetches a linked note for the inline `/note` block. */
  readonly embedSource = input<EmbedSource | null>(null);

  /** The html after every change the person makes. */
  readonly changed = output<string>();
  readonly ready = output<void>();

  protected readonly menu = signal<MenuState | null>(null);
  protected readonly tick = signal(0);
  protected readonly linkOpen = signal(false);
  protected readonly tableOpen = signal(false);
  protected readonly linkUrl = signal('https://');
  protected readonly rows = signal(3);
  protected readonly cols = signal(3);
  protected readonly headerRow = signal(true);

  constructor() {
    afterNextRender(() => this.create());
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
    effect(() => {
      const editable = this.editable();
      untracked(() => this.editor?.setEditable(editable));
    });
    effect(() => {
      const key = this.contentKey();
      const html = this.html();
      void key;
      untracked(() => {
        if (this.editor) this.editor.commands.setContent(html, { emitUpdate: false });
        this.tick.update((n) => n + 1);
      });
    });
  }

  protected readonly styleItems: DropdownItem[] = [
    { value: 'p', label: 'Paragraph' },
    { value: 'h1', label: 'Heading 1' },
    { value: 'h2', label: 'Heading 2' },
    { value: 'h3', label: 'Heading 3' },
  ];

  protected style(): string {
    this.tick();
    const e = this.editor;
    if (!e) return 'p';
    for (const level of [1, 2, 3]) if (e.isActive('heading', { level })) return `h${level}`;
    return 'p';
  }

  protected active(name: string): boolean {
    this.tick();
    return this.editor?.isActive(name) ?? false;
  }

  protected inTable(): boolean {
    this.tick();
    return this.editor?.isActive('table') ?? false;
  }

  protected run(command: string): void {
    const chain = this.editor?.chain().focus() as unknown as
      Record<string, () => { run: () => boolean }> | undefined;
    chain?.[command]?.().run();
  }

  protected setStyle(value: string): void {
    const chain = this.editor?.chain().focus();
    if (!chain) return;
    if (value === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  }

  protected clearFormatting(): void {
    this.editor?.chain().focus().unsetAllMarks().clearNodes().run();
  }

  protected insertTable(): void {
    const rows = Math.min(20, Math.max(1, this.rows()));
    const cols = Math.min(10, Math.max(1, this.cols()));
    this.editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: this.headerRow() }).run();
    this.tableOpen.set(false);
  }

  protected applyLink(): void {
    const url = this.linkUrl().trim();
    if (/^(https?:\/\/|mailto:)/i.test(url))
      this.editor?.chain().focus().setLink({ href: url }).run();
    this.linkOpen.set(false);
  }

  protected removeLink(): void {
    this.editor?.chain().focus().unsetLink().run();
    this.linkOpen.set(false);
  }

  /** The toolbar buttons @ and #: type the trigger character, which opens the same menu as typing it. */
  protected trigger(char: string): void {
    this.editor?.chain().focus().insertContent(char).run();
  }

  /** Puts keyboard focus in the text (a new note, or after Edit). */
  focus(): void {
    this.editor?.commands.focus('start');
  }

  getHtml(): string {
    return this.editor?.getHTML() ?? '';
  }

  private create(): void {
    const plugin = (editor: Editor, char: string, key: string, kind: RefKind | null) =>
      this.plugin(editor, char, key, kind);
    const suggestions = Extension.create({
      name: 'noteSuggestions',
      addProseMirrorPlugins() {
        return [
          plugin(this.editor, '@', 'at', 'user'),
          plugin(this.editor, '#', 'hash', 'asset'),
          plugin(this.editor, '/', 'slash', null),
        ];
      },
    });
    this.editor = new Editor({
      element: this.hostEl().nativeElement,
      content: this.html(),
      editable: this.editable(),
      extensions: [
        ...baseExtensions(),
        Placeholder.configure({ placeholder: this.placeholder() }),
        embedNode(() => this.embedSource()),
        suggestions,
      ],
      editorProps: {
        attributes: { 'aria-label': 'Note text', role: 'textbox', 'aria-multiline': 'true' },
      },
      onUpdate: ({ editor }) => this.changed.emit(editor.getHTML()),
      onTransaction: () => this.tick.update((n) => n + 1),
    });
    this.ready.emit();
  }

  /** One typing trigger: the character, a key for the plugin and the kind it searches (null for the slash menu, which asks for a command first). */
  private plugin(editor: Editor, char: string, key: string, kind: RefKind | null) {
    return Suggestion<SuggestItem, SuggestItem>({
      editor,
      char,
      pluginKey: new PluginKey(`noteSuggest-${key}`),
      allowSpaces: true,
      allow: () => this.editable(),
      items: async ({ query }) => this.itemsFor(kind, query),
      command: ({ editor: ed, range, props }) => {
        if (props.kind === 'command') {
          // /asset: keep typing in the same place, the menu now searches that kind.
          ed.chain().focus().insertContentAt(range, `/${props.command} `).run();
          return;
        }
        const node =
          props.kind === 'embed'
            ? { type: 'noteEmbed', attrs: { refId: props.id, label: props.label } }
            : {
                type: 'ref',
                attrs: {
                  kind: props.kind,
                  refId: props.id,
                  label: `${REF_PREFIX[props.kind as RefKind]}${props.label}`,
                },
              };
        ed.chain()
          .focus()
          .insertContentAt(range, [node, { type: 'text', text: ' ' }])
          .run();
      },
      render: () => ({
        onStart: (p) => this.showMenu(p, char, kind),
        onUpdate: (p) => this.showMenu(p, char, kind),
        onKeyDown: (p) => this.menuKey(p),
        onExit: () => this.menu.set(null),
      }),
    });
  }

  private async itemsFor(kind: RefKind | null, query: string): Promise<SuggestItem[]> {
    const source = this.source();
    if (kind !== null) return source ? source(kind, query.trim()) : [];
    const m = /^([a-z]+)\s(.*)$/.exec(query);
    const command = m ? SLASH_COMMANDS.find((c) => c.command === m[1]) : undefined;
    if (command && source) return source(command.kind, m![2].trim());
    const typed = query.trim().toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.command.startsWith(typed)).map((c) => ({
      kind: 'command' as const,
      id: 0,
      label: `/${c.command}`,
      sub: c.sub,
      command: c.command,
    }));
  }

  private showMenu(
    p: SuggestionProps<SuggestItem, SuggestItem>,
    char: string,
    kind: RefKind | null,
  ): void {
    const rect = p.clientRect?.();
    const label = char === '@' ? 'People' : char === '#' ? 'Assets of this matter' : 'Commands';
    void kind;
    const previous = this.menu();
    this.menu.set({
      items: p.items,
      index:
        previous && previous.items.length === p.items.length
          ? Math.min(previous.index, p.items.length - 1)
          : 0,
      left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 280)),
      top: (rect?.bottom ?? 0) + 6,
      label,
      pick: (item) => p.command(item),
    });
  }

  private menuKey(p: SuggestionKeyDownProps): boolean {
    const m = this.menu();
    if (!m) return false;
    const e = p.event;
    if (e.key === 'ArrowDown') {
      this.menu.set({ ...m, index: Math.min(m.items.length - 1, m.index + 1) });
      return true;
    }
    if (e.key === 'ArrowUp') {
      this.menu.set({ ...m, index: Math.max(0, m.index - 1) });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const item = m.items[m.index];
      if (!item) return false;
      m.pick(item);
      return true;
    }
    if (e.key === 'Escape') {
      this.menu.set(null);
      return true;
    }
    return false;
  }
}
