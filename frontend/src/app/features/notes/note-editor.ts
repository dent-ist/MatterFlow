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
import { AnyExtension, Editor, Extension, Mark, Node } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Suggestion, { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';

/** The text colours of a note (the server keeps exactly these keys; the tokens are `--mf-note-<key>`, theme guide section 10). */
export const NOTE_COLOURS: readonly { key: string; label: string }[] = [
  { key: 'red', label: 'Red' },
  { key: 'orange', label: 'Orange' },
  { key: 'amber', label: 'Amber' },
  { key: 'green', label: 'Green' },
  { key: 'teal', label: 'Teal' },
  { key: 'blue', label: 'Blue' },
  { key: 'violet', label: 'Violet' },
  { key: 'slate', label: 'Grey' },
];

/** Text colour as a mark: stored as `<span data-color="key">`, never as CSS. */
function colourMark(): Mark {
  return Mark.create({
    name: 'noteColour',
    addAttributes() {
      return { colour: { default: null } };
    },
    parseHTML() {
      return [
        {
          tag: 'span[data-color]',
          getAttrs: (el: HTMLElement | string) => {
            if (typeof el === 'string') return false;
            const c = el.getAttribute('data-color');
            return NOTE_COLOURS.some((x) => x.key === c) ? { colour: c } : false;
          },
        },
      ];
    },
    renderHTML({ mark }) {
      return ['span', { 'data-color': String(mark.attrs['colour']) }, 0];
    },
  });
}

/** The kinds of thing a note can refer to; `embed` shows another note inline. */
export type RefKind = 'asset' | 'project' | 'matter' | 'note' | 'user' | 'embed';

/** What the menus search: the kinds a note can refer to, and the firm's note templates (`/template`). */
export type SuggestKind = RefKind | 'template';

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

/** The icon in front of a reference chip (a person has none: the `@` is its mark). */
const REF_ICON: Record<RefKind, string> = {
  asset: 'pi-database',
  project: 'pi-folder',
  matter: 'pi-briefcase',
  note: 'pi-file',
  user: '',
  embed: 'pi-file',
};

export interface SuggestItem {
  kind: SuggestKind | 'command';
  id: number;
  label: string;
  sub?: string;
  /** For a command: its word (`asset`, `mention`, ...). */
  command?: string;
  /** A PrimeIcons class for the tile in front of the row. */
  icon?: string;
}

/** The slash commands of the owner's list (owner decision 2026-11-02: /template first; no /assets, no /task). */
export const SLASH_COMMANDS: readonly {
  command: string;
  label: string;
  sub: string;
  kind: SuggestKind;
  icon: string;
}[] = [
  {
    command: 'template',
    label: 'Template',
    sub: 'Insert a ready-made note: its text goes in at the cursor',
    kind: 'template',
    icon: 'pi-clone',
  },
  {
    command: 'asset',
    label: 'Asset',
    sub: 'Reference an asset of this matter (shortcut: #)',
    kind: 'asset',
    icon: 'pi-database',
  },
  {
    command: 'mention',
    label: 'Mention',
    sub: 'Mention a person (shortcut: @)',
    kind: 'user',
    icon: 'pi-at',
  },
  {
    command: 'project',
    label: 'Project',
    sub: 'Reference a project of this matter',
    kind: 'project',
    icon: 'pi-folder',
  },
  {
    command: 'matter',
    label: 'Matter',
    sub: 'Reference a matter you can see',
    kind: 'matter',
    icon: 'pi-briefcase',
  },
  {
    command: 'note',
    label: 'Note',
    sub: 'Show another note of this matter inline, read only',
    kind: 'embed',
    icon: 'pi-file',
  },
];

/** Where the menu gets its rows: the host searches the API. */
export type SuggestSource = (kind: SuggestKind, query: string) => Promise<SuggestItem[]>;

interface MenuState {
  items: SuggestItem[];
  index: number;
  left: number;
  /** Below the caret (`top`) or above it (`bottom`) when there is no room. */
  top: number | null;
  bottom: number | null;
  label: string;
  heading: string;
  /** The command whose list is open ("Asset"), shown as a breadcrumb; empty on the first level. */
  crumb: string;
  hint: string;
  empty: string;
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
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        protocols: [{ scheme: 'onenote', optionalSlashes: true }],
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
    colourMark(),
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
        dom.dataset['refKind'] = kind;
        dom.dataset['refId'] = String(node.attrs['refId']);
        dom.className = `ne-ref ne-ref--${kind}`;
        const icon = REF_ICON[kind];
        if (icon) {
          const i = document.createElement('i');
          i.className = `pi ${icon}`;
          i.setAttribute('aria-hidden', 'true');
          dom.append(i);
        }
        const text = document.createElement('span');
        text.className = 'ne-ref__text';
        text.textContent = node.attrs['label'] as string;
        dom.append(text);
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
        const head = document.createElement('span');
        head.className = 'ne-embed__head';
        const icon = document.createElement('i');
        icon.className = 'pi pi-file';
        icon.setAttribute('aria-hidden', 'true');
        const kindLabel = document.createElement('span');
        kindLabel.className = 'ne-embed__kind';
        kindLabel.textContent = 'Linked note';
        const title = document.createElement('span');
        title.className = 'ne-embed__title';
        title.textContent = node.attrs['label'] as string;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'ne-embed__open';
        open.dataset['embedOpen'] = String(node.attrs['refId']);
        open.textContent = 'Open note';
        head.append(icon, kindLabel, title, open);
        const body = document.createElement('span');
        body.className = 'ne-embed__body';
        dom.append(head, body);
        let inner: Editor | null = null;
        let gone = false;
        // The linked note is shown through the same schema as the editor (read only), never as raw html.
        void source()?.(node.attrs['refId'] as number).then((content) => {
          if (gone) return;
          if (!content) {
            title.textContent = 'This note is not available to you';
            open.hidden = true;
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

/** A link the toolbar may write: https, or a OneNote page (`onenote:https://`). The server allows the same two (RichHtml, Note profile). */
export const LINK_OK = /^(https:\/\/|onenote:https:\/\/)[^\s<>"']+$/i;

/** One reference the host resolved: what the reader may do with its chip (Ok, Inactive, Restricted, Removed) and the words of its state tag. */
export interface RefInfo {
  state: string;
  stateText?: string;
}

/**
 * The rich-text editor of a note (epic #1001, MD-13 and MD-14; parity checklist docs/ux/matter-detail/notes-parity.md): TipTap (ProseMirror) with the toolbar of the
 * mockup (paragraph style, bold, italic, underline, bullets, numbers, quote, link dialog, a 3 by 3 table with its tools, `@`, `#`, clear formatting, undo, redo) and
 * the typing triggers `@` (a person), `#` (an asset) and `/` (the commands /asset, /mention, /project, /matter, /note). These are keys of the widget, not app
 * shortcuts (#420): they act only while the text field has focus. Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Z and Ctrl+Y are the editor's own; there is no Ctrl+K.
 *
 * The editor is the only place the html of a note is parsed on the client; the server sanitises what it stores (allow-list, one reference span with one data
 * attribute) and what comes back is shown again through this schema, so unknown markup is dropped here as well. Load it lazily (`@defer`): it carries ProseMirror.
 */
@Component({
  selector: 'mf-note-editor',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./note-editor.scss', './note-editor-refs.scss', './note-editor-colours.scss'],
  template: `
    <div class="ne" [class.ne--edit]="editable()" [class.ne--read]="!editable()" data-note-editor>
      @if (editable()) {
        <div class="ne__top">
          <div
            class="ne__bar"
            #bar
            role="toolbar"
            aria-label="Text formatting"
            data-editor-toolbar
            tabindex="-1"
            (keydown)="barKey($event)"
            (focusin)="barFocus($event)"
          >
            <mf-dropdown
              buttonId="ne-style"
              label="Text Style"
              size="sm"
              [items]="styleItems"
              [value]="style()"
              (valueChange)="setStyle($event)"
            />
            <button
              type="button"
              class="ne__btn"
              aria-label="Bold"
              title="Bold (Ctrl+B)"
              [attr.aria-pressed]="active('bold')"
              (mousedown)="$event.preventDefault()"
              (click)="run('toggleBold')"
            >
              <b class="ne__glyph">B</b>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Italic"
              title="Italic (Ctrl+I)"
              [attr.aria-pressed]="active('italic')"
              (mousedown)="$event.preventDefault()"
              (click)="run('toggleItalic')"
            >
              <i class="ne__glyph ne__glyph--i">I</i>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Underline"
              title="Underline (Ctrl+U)"
              [attr.aria-pressed]="active('underline')"
              (mousedown)="$event.preventDefault()"
              (click)="run('toggleUnderline')"
            >
              <u class="ne__glyph">U</u>
            </button>
            <span class="ne__colour">
              <button
                type="button"
                class="ne__btn"
                data-text-colour
                aria-haspopup="menu"
                [attr.aria-expanded]="colourOpen()"
                [attr.aria-label]="'Text colour: ' + colourLabel()"
                [title]="'Text colour: ' + colourLabel()"
                (mousedown)="$event.preventDefault()"
                (click)="toggleColour()"
              >
                <b class="ne__glyph">A</b>
                <span class="ne__swatch" [attr.data-color]="currentColour()"></span>
              </button>
              @if (colourOpen()) {
                <ul
                  class="ne__cmenu"
                  role="menu"
                  aria-label="Text colour"
                  tabindex="-1"
                  data-colour-menu
                  (keydown)="colourKey($event)"
                >
                  <li role="none">
                    <button
                      type="button"
                      role="menuitemradio"
                      [attr.aria-checked]="currentColour() === ''"
                      (mousedown)="$event.preventDefault()"
                      (click)="setColour('')"
                    >
                      <span class="ne__swatch ne__swatch--default"></span>Default
                    </button>
                  </li>
                  @for (c of colours; track c.key) {
                    <li role="none">
                      <button
                        type="button"
                        role="menuitemradio"
                        [attr.aria-checked]="currentColour() === c.key"
                        (mousedown)="$event.preventDefault()"
                        (click)="setColour(c.key)"
                      >
                        <span class="ne__swatch" [attr.data-color]="c.key"></span>{{ c.label }}
                      </button>
                    </li>
                  }
                </ul>
              }
            </span>
            <span class="ne__sep" role="separator" aria-orientation="vertical"></span>
            <button
              type="button"
              class="ne__btn"
              aria-label="Bulleted list"
              title="Bulleted list"
              [attr.aria-pressed]="active('bulletList')"
              (mousedown)="$event.preventDefault()"
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
              (mousedown)="$event.preventDefault()"
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
              (mousedown)="$event.preventDefault()"
              (click)="run('toggleBlockquote')"
            >
              <i class="pi pi-comment" aria-hidden="true"></i>
            </button>
            <span class="ne__sep" role="separator" aria-orientation="vertical"></span>
            <button
              type="button"
              class="ne__btn"
              aria-label="Link"
              title="Link"
              data-insert-link
              [attr.aria-pressed]="active('link')"
              (mousedown)="$event.preventDefault()"
              (click)="openLink()"
            >
              <i class="pi pi-link" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Insert table, 3 by 3"
              title="Insert table, 3 by 3"
              data-insert-table
              (mousedown)="$event.preventDefault()"
              (click)="insertTable()"
            >
              <i class="pi pi-table" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Mention a person"
              title="Mention a person (@)"
              data-insert-mention
              (mousedown)="$event.preventDefault()"
              (click)="trigger('@')"
            >
              <i class="pi pi-at" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Reference an asset"
              title="Reference an asset (#)"
              data-insert-asset
              (mousedown)="$event.preventDefault()"
              (click)="trigger('#')"
            >
              <i class="pi pi-hashtag" aria-hidden="true"></i>
            </button>
            <span class="ne__sep" role="separator" aria-orientation="vertical"></span>
            <button
              type="button"
              class="ne__btn"
              aria-label="Clear formatting"
              title="Clear formatting"
              (mousedown)="$event.preventDefault()"
              (click)="clearFormatting()"
            >
              <i class="pi pi-eraser" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              [attr.aria-disabled]="!canUndo()"
              (mousedown)="$event.preventDefault()"
              (click)="canUndo() && run('undo')"
            >
              <i class="pi pi-undo" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="ne__btn"
              aria-label="Redo"
              title="Redo (Ctrl+Y)"
              [attr.aria-disabled]="!canRedo()"
              (mousedown)="$event.preventDefault()"
              (click)="canRedo() && run('redo')"
            >
              <i class="pi pi-undo ne__flip" aria-hidden="true"></i>
            </button>
          </div>
          @if (inTable()) {
            <div class="ne__tablebar" role="toolbar" aria-label="Table tools" data-table-tools>
              <span class="ne__tablelabel">Table</span>
              <button
                type="button"
                aria-label="Add row below"
                (mousedown)="$event.preventDefault()"
                (click)="run('addRowAfter')"
              >
                + Row
              </button>
              <button
                type="button"
                aria-label="Delete row"
                (mousedown)="$event.preventDefault()"
                (click)="run('deleteRow')"
              >
                &minus; Row
              </button>
              <button
                type="button"
                aria-label="Add column after"
                (mousedown)="$event.preventDefault()"
                (click)="run('addColumnAfter')"
              >
                + Col
              </button>
              <button
                type="button"
                aria-label="Delete column"
                (mousedown)="$event.preventDefault()"
                (click)="run('deleteColumn')"
              >
                &minus; Col
              </button>
              <button
                type="button"
                aria-label="Header row on or off"
                [attr.aria-pressed]="headerOn()"
                (mousedown)="$event.preventDefault()"
                (click)="run('toggleHeaderRow')"
              >
                Header Row
              </button>
              <button
                type="button"
                aria-label="Delete table"
                (mousedown)="$event.preventDefault()"
                (click)="run('deleteTable')"
              >
                Delete Table
              </button>
            </div>
          }
        </div>
      }
      <div class="ne__area" #host data-editor-area></div>
      @if (editable()) {
        @if (emptyDoc()) {
          <p class="ne__hint" data-editor-hint data-editor-empty-hint>
            Type <kbd>/</kbd> for commands, for example <kbd>/template</kbd> to start from a
            template.
          </p>
        } @else {
          <p class="ne__hint" data-editor-hint>
            Type <kbd>/</kbd> for commands (template, asset, mention, project, matter, note),
            <kbd>&#64;</kbd> for people, <kbd>#</kbd> for assets.
          </p>
        }
      }
      @if (menu(); as m) {
        <ul
          class="ne__menu"
          id="ne-menu"
          role="listbox"
          [attr.aria-label]="m.label"
          [style.left.px]="m.left"
          [style.top.px]="m.top"
          [style.bottom.px]="m.bottom"
          data-suggest-menu
        >
          <li class="ne__menu-hd" role="presentation">
            @if (m.crumb) {
              <span class="ne__crumb"
                >{{ m.crumb }} <i class="pi pi-chevron-right" aria-hidden="true"></i
              ></span>
            } @else {
              {{ m.heading }}
            }
            <span class="ne__keys">{{ m.hint }}</span>
          </li>
          @for (item of m.items; track $index) {
            <li
              role="option"
              [id]="'ne-opt-' + $index"
              [attr.aria-selected]="$index === m.index"
              (mousedown)="$event.preventDefault(); m.pick(item)"
            >
              @if (item.kind === 'command') {
                <span class="ne__tile" aria-hidden="true"
                  ><i class="pi" [class]="'pi ' + (item.icon ?? 'pi-slash')"></i
                ></span>
              } @else if (item.kind === 'user') {
                <span class="ne__av" aria-hidden="true">{{ initials(item.label) }}</span>
              } @else {
                <span class="ne__tile" aria-hidden="true"
                  ><i class="pi" [class]="'pi ' + (item.icon ?? 'pi-file')"></i
                ></span>
              }
              <span class="ne__nm"
                >{{ item.label }}
                @if (item.sub) {
                  <small>{{ item.sub }}</small>
                }
              </span>
            </li>
          } @empty {
            <li class="ne__none" role="presentation">
              {{ m.empty }}
            </li>
          }
        </ul>
      }
      @if (linkOpen()) {
        <div class="ne__bg">
          <div
            class="ne__dlg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ne-link-title"
            (keydown)="linkKey($event)"
          >
            <h2 id="ne-link-title">{{ linkEditing() ? 'Edit link' : 'Add a link' }}</h2>
            <label for="ne-link">Address</label>
            <input
              id="ne-link"
              #linkInput
              type="text"
              inputmode="url"
              autocomplete="off"
              placeholder="https://..."
              aria-describedby="ne-link-help ne-link-err"
              [attr.aria-invalid]="linkError() ? 'true' : null"
              [value]="linkUrl()"
              (input)="linkUrl.set($any($event.target).value)"
              (keydown.enter)="$event.preventDefault(); applyLink()"
            />
            <p class="ne__help" id="ne-link-help">
              Starts with https:// or onenote:https:// (OneNote pages).
            </p>
            <p class="ne__err" id="ne-link-err" role="alert">{{ linkError() }}</p>
            @if (linkNeedsText()) {
              <label for="ne-link-text">Text to Show</label>
              <input
                id="ne-link-text"
                type="text"
                autocomplete="off"
                placeholder="Shown in the note"
                [value]="linkText()"
                (input)="linkText.set($any($event.target).value)"
                (keydown.enter)="$event.preventDefault(); applyLink()"
              />
            }
            <div class="ne__dlg-foot">
              @if (linkEditing()) {
                <button
                  type="button"
                  class="mf-btn mf-btn--text mf-btn--danger"
                  data-link-remove
                  (click)="removeLink()"
                >
                  Remove Link
                </button>
              }
              <span class="ne__grow"></span>
              <button type="button" class="mf-btn" (click)="closeLink()">Cancel</button>
              <button
                type="button"
                class="mf-btn mf-btn--primary"
                data-link-apply
                (click)="applyLink()"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class NoteEditor {
  private readonly hostEl = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly barEl = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly linkInputEl = viewChild<ElementRef<HTMLInputElement>>('linkInput');
  private editor: Editor | null = null;
  private linkRestore: Range | null = null;

  /** The html to start from. A different `contentKey` loads it again (a different note); typing never reads it back. */
  readonly html = input('');
  readonly contentKey = input<unknown>(null);
  readonly editable = input(false);
  readonly placeholder = input('Untitled note');
  /** Searches the API for the menu (people, assets, projects, matters, notes). Without it the triggers do nothing. */
  readonly source = input<SuggestSource | null>(null);
  /** Fetches a linked note for the inline `/note` block. */
  readonly embedSource = input<EmbedSource | null>(null);
  /** What the host knows about the references in the text (`kind:id`): their state decides the tag on the chip and whether it can be opened. */
  readonly refInfo = input<Record<string, RefInfo>>({});
  /** Marks `{{placeholder}}` words in the text (the template views); the text itself stays plain. */
  readonly highlightTokens = input(false);

  /** The html after every change the person makes. */
  readonly changed = output<string>();
  readonly ready = output<void>();
  /** A chip or the "Open note" button of a linked note was used (read mode): the host opens the item. */
  readonly refOpen = output<{ kind: RefKind; id: number }>();
  /** A short message for the host's live region ("Formatting cleared"). */
  readonly notice = output<string>();
  /** `/template` picked a template: the host answers with `applyTemplate`. */
  readonly templateChosen = output<number>();

  protected readonly colours = NOTE_COLOURS;
  protected readonly colourOpen = signal(false);
  protected readonly menu = signal<MenuState | null>(null);
  protected readonly tick = signal(0);
  protected readonly linkOpen = signal(false);
  protected readonly linkUrl = signal('');
  protected readonly linkText = signal('');
  protected readonly linkError = signal('');
  protected readonly linkEditing = signal(false);
  protected readonly linkNeedsText = signal(false);

  constructor() {
    afterNextRender(() => this.create());
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
    effect(() => {
      const editable = this.editable();
      untracked(() => {
        this.editor?.setEditable(editable);
        this.decorate();
      });
    });
    effect(() => {
      // Only a different `contentKey` (another note, another mode) loads the text again. `html` is read WITHOUT being tracked: a host that keeps the typed
      // text in a signal and passes it back (the template form) would otherwise reset the document on every keystroke and throw the caret to the end (MD-38).
      const key = this.contentKey();
      void key;
      untracked(() => {
        const html = this.html();
        if (this.editor) this.editor.commands.setContent(html, { emitUpdate: false });
        this.tick.update((n) => n + 1);
        queueMicrotask(() => {
          this.decorate();
          this.markTokens();
        });
      });
    });
    effect(() => {
      this.refInfo();
      untracked(() => this.decorate());
    });
    effect(() => {
      const m = this.menu();
      const dom = this.editor?.view.dom;
      if (!dom) return;
      if (m) {
        dom.setAttribute('aria-controls', 'ne-menu');
        dom.setAttribute('aria-haspopup', 'listbox');
        dom.setAttribute('aria-expanded', 'true');
        dom.setAttribute('aria-activedescendant', `ne-opt-${m.index}`);
      } else {
        for (const a of [
          'aria-controls',
          'aria-haspopup',
          'aria-expanded',
          'aria-activedescendant',
        ])
          dom.removeAttribute(a);
      }
    });
    effect(() => {
      if (this.linkOpen()) queueMicrotask(() => this.linkInputEl()?.nativeElement.focus());
    });
  }

  protected currentColour(): string {
    this.tick();
    return (this.editor?.getAttributes('noteColour')['colour'] as string | undefined) ?? '';
  }

  protected colourLabel(): string {
    return NOTE_COLOURS.find((c) => c.key === this.currentColour())?.label ?? 'Default';
  }

  protected toggleColour(): void {
    this.colourOpen.update((o) => !o);
    if (this.colourOpen())
      setTimeout(() => {
        const root = this.barEl()?.nativeElement;
        (
          root?.querySelector<HTMLElement>('[data-colour-menu] [aria-checked="true"]') ??
          root?.querySelector<HTMLElement>('[data-colour-menu] button')
        )?.focus();
      }, 0);
  }

  protected setColour(key: string): void {
    const chain = this.editor?.chain().focus();
    if (!chain) return;
    if (key) chain.setMark('noteColour', { colour: key }).run();
    else chain.unsetMark('noteColour').run();
    this.colourOpen.set(false);
    this.notice.emit(
      key ? `Text colour ${NOTE_COLOURS.find((c) => c.key === key)?.label}` : 'Default text colour',
    );
  }

  /** The colour menu: Up and Down move, Home and End jump, Escape closes and the focus goes back to the button. */
  protected colourKey(ev: KeyboardEvent): void {
    const items = Array.from(
      (ev.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button'),
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to =
      ev.key === 'ArrowDown'
        ? (i + 1) % items.length
        : ev.key === 'ArrowUp'
          ? (i - 1 + items.length) % items.length
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? items.length - 1
              : -1;
    if (to >= 0) {
      ev.preventDefault();
      ev.stopPropagation();
      items[to].focus();
    } else if (ev.key === 'Escape' || ev.key === 'Tab') {
      if (ev.key === 'Escape') ev.preventDefault();
      ev.stopPropagation();
      this.colourOpen.set(false);
      this.barEl()?.nativeElement.querySelector<HTMLElement>('[data-text-colour]')?.focus();
    }
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

  protected headerOn(): boolean {
    this.tick();
    return this.editor?.isActive('tableHeader') ?? false;
  }

  /** True while the text is empty (a new note): the hint under the box then names /template. */
  protected emptyDoc(): boolean {
    this.tick();
    return this.editor?.isEmpty ?? true;
  }

  protected canUndo(): boolean {
    this.tick();
    return this.editor?.can().undo() ?? false;
  }

  protected canRedo(): boolean {
    this.tick();
    return this.editor?.can().redo() ?? false;
  }

  protected initials(name: string): string {
    return name
      .replace(/^@/, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
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

  /** Marks, a link, a heading, a quote or a list become plain text again; a table stays. */
  protected clearFormatting(): void {
    this.editor?.chain().focus().unsetAllMarks().clearNodes().run();
    this.notice.emit('Formatting cleared');
  }

  /** One click: a 3 by 3 table with a header row, the caret in its first cell. */
  protected insertTable(): void {
    this.editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  // ---- link dialog (https:// or onenote:https://)

  protected openLink(): void {
    const e = this.editor;
    if (!e) return;
    const sel = window.getSelection();
    this.linkRestore = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const inLink = e.isActive('link');
    this.linkEditing.set(inLink);
    this.linkNeedsText.set(e.state.selection.empty && !inLink);
    this.linkUrl.set(inLink ? String(e.getAttributes('link')['href'] ?? '') : '');
    this.linkText.set('');
    this.linkError.set('');
    this.linkOpen.set(true);
  }

  protected closeLink(): void {
    this.linkOpen.set(false);
    this.editor?.commands.focus();
  }

  protected applyLink(): void {
    const url = this.linkUrl().trim();
    if (!LINK_OK.test(url) || url.length > 2048) {
      this.linkError.set('Enter an address that starts with https:// or onenote:https://');
      this.linkInputEl()?.nativeElement.focus();
      return;
    }
    const e = this.editor;
    if (!e) return;
    if (this.linkNeedsText()) {
      const text = this.linkText().trim() || url;
      e.chain()
        .focus()
        .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] })
        .insertContent(' ')
        .run();
    } else {
      e.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    this.linkOpen.set(false);
  }

  protected removeLink(): void {
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.linkOpen.set(false);
  }

  /** A dialog traps Tab and closes on Escape (the person's focus goes back to the text). */
  protected linkKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeLink();
      return;
    }
    if (ev.key !== 'Tab') return;
    const dlg = ev.currentTarget as HTMLElement;
    const items = Array.from(dlg.querySelectorAll<HTMLElement>('input, button')).filter(
      (x) => !x.hasAttribute('disabled'),
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  // ---- toolbar keys: Left, Right, Home and End move inside it (one tab stop)

  protected barKey(ev: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const bar = this.barEl()?.nativeElement;
    if (!bar) return;
    const buttons = Array.from(bar.querySelectorAll<HTMLElement>('button'));
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    ev.preventDefault();
    const j =
      ev.key === 'ArrowRight'
        ? (i + 1) % buttons.length
        : ev.key === 'ArrowLeft'
          ? (i - 1 + buttons.length) % buttons.length
          : ev.key === 'Home'
            ? 0
            : buttons.length - 1;
    buttons[j].focus();
  }

  protected barFocus(ev: FocusEvent): void {
    const bar = this.barEl()?.nativeElement;
    const target = ev.target as HTMLElement;
    if (!bar || target.tagName !== 'BUTTON') return;
    for (const b of Array.from(bar.querySelectorAll<HTMLElement>('button')))
      b.tabIndex = b === target ? 0 : -1;
  }

  /** The toolbar buttons @ and #: type the trigger character, which opens the same menu as typing it. */
  protected trigger(char: string): void {
    this.editor?.chain().focus().insertContent(char).run();
  }

  /** True while the text is only the empty first line (a new note), so a template may fill the title line too. */
  isEmpty(): boolean {
    return this.editor?.isEmpty ?? true;
  }

  /** Puts a template's text in: all of it when the note is empty, otherwise at the cursor (the title line is not touched). */
  applyTemplate(html: string, replaceAll: boolean): void {
    const chain = this.editor?.chain().focus();
    if (!chain) return;
    if (replaceAll) chain.setContent(html, { emitUpdate: true }).run();
    else chain.insertContent(html).run();
  }

  /** Puts keyboard focus in the text (a new note, or after Edit). */
  focus(): void {
    // The editor loads lazily: when the person has already clicked into the text, the caret stays where they put it.
    if (this.hostEl().nativeElement.contains(document.activeElement)) return;
    this.editor?.commands.focus('start');
  }

  getHtml(): string {
    return this.editor?.getHTML() ?? '';
  }

  /** Read mode: chips become links (or stay plain when the item is removed or restricted); the state of each shows as a tag. */
  private decorate(): void {
    const root = this.hostEl().nativeElement;
    const read = !this.editable();
    for (const chip of Array.from(root.querySelectorAll<HTMLElement>('.ne-ref'))) {
      const kind = chip.dataset['refKind'] as RefKind;
      const info = this.refInfo()[`${kind}:${chip.dataset['refId']}`];
      const gone = info?.state === 'Removed' || info?.state === 'Restricted';
      const kindWord = kind === 'user' ? 'Person' : kind[0].toUpperCase() + kind.slice(1);
      const text = chip.querySelector<HTMLElement>('.ne-ref__text');
      const label = text?.textContent ?? '';
      chip.classList.toggle('ne-ref--gone', !!gone);
      if (info?.stateText) chip.dataset['state'] = info.stateText;
      else delete chip.dataset['state'];
      if (gone) {
        chip.dataset['state'] = info.state === 'Restricted' ? 'no access' : 'removed';
        if (text) text.textContent = `${info.state} ${kind}`;
      }
      if (read && !gone && kind !== 'user') {
        chip.tabIndex = 0;
        chip.setAttribute('role', 'link');
        chip.setAttribute(
          'aria-label',
          `${kindWord} ${label}${info?.stateText ? ` (${info.stateText})` : ''}, opens in a new window`,
        );
      } else {
        chip.removeAttribute('tabindex');
        chip.removeAttribute('role');
        chip.removeAttribute('aria-label');
      }
    }
  }

  /** The CSS Custom Highlight API paints `{{word}}` ranges without changing the text (no markup is stored). */
  private markTokens(): void {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !H) return;
    if (!this.highlightTokens()) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(this.hostEl().nativeElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const m of (n.textContent ?? '').matchAll(/\{\{[A-Za-z][A-Za-z0-9_ -]*\}\}/g)) {
        const r = new Range();
        r.setStart(n, m.index ?? 0);
        r.setEnd(n, (m.index ?? 0) + m[0].length);
        ranges.push(r);
      }
    }
    reg.set('mf-tok', new H(...ranges));
  }

  private onReadClick(ev: Event): void {
    if (this.editable()) return;
    const target = ev.target as HTMLElement;
    const open = target.closest<HTMLElement>('[data-embed-open]');
    if (open) {
      this.refOpen.emit({ kind: 'note', id: Number(open.dataset['embedOpen']) });
      return;
    }
    const chip = target.closest<HTMLElement>('.ne-ref');
    if (!chip || chip.classList.contains('ne-ref--gone')) return;
    const kind = chip.dataset['refKind'] as RefKind;
    if (kind === 'user') return;
    this.refOpen.emit({ kind, id: Number(chip.dataset['refId']) });
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
        // Paste is plain text only and nothing is dropped into the text (the mockup's rule: no foreign markup).
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return true;
          view.dispatch(view.state.tr.insertText(text));
          return true;
        },
        handleDrop: () => true,
      },
      onUpdate: ({ editor }) => {
        this.changed.emit(editor.getHTML());
        this.markTokens();
      },
      onTransaction: () => this.tick.update((n) => n + 1),
    });
    const root = this.hostEl().nativeElement;
    root.addEventListener('click', (ev) => this.onReadClick(ev));
    root.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && !this.editable()) {
        const chip = (ev.target as HTMLElement).closest('.ne-ref');
        if (chip) {
          ev.preventDefault();
          this.onReadClick(ev);
        }
      }
    });
    // Tab stops of the toolbar: only the first button is in the tab order.
    queueMicrotask(() => {
      const buttons = Array.from(this.barEl()?.nativeElement.querySelectorAll('button') ?? []);
      buttons.forEach((b, i) => (b.tabIndex = i === 0 ? 0 : -1));
      this.decorate();
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
        if (props.kind === 'template') {
          // /template: the typed text goes, the host fills the placeholders and puts the body in (or fills an empty note).
          ed.chain().focus().deleteRange(range).run();
          this.templateChosen.emit(props.id);
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
    if (kind !== null) return source ? this.withIcon(await source(kind, query.trim())) : [];
    const m = /^([a-z]+)\s(.*)$/.exec(query);
    const command = m ? SLASH_COMMANDS.find((c) => c.command === m[1]) : undefined;
    if (command && source) return this.withIcon(await source(command.kind, m![2].trim()));
    const typed = query.trim().toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.command.startsWith(typed)).map((c) => ({
      kind: 'command' as const,
      id: 0,
      label: `/${c.command}`,
      sub: c.sub,
      command: c.command,
      icon: c.icon,
    }));
  }

  private withIcon(items: SuggestItem[]): SuggestItem[] {
    return items.map((i) => ({
      ...i,
      icon:
        i.icon ??
        (i.kind === 'command' ? undefined : i.kind === 'template' ? 'pi-clone' : REF_ICON[i.kind]),
    }));
  }

  private showMenu(
    p: SuggestionProps<SuggestItem, SuggestItem>,
    char: string,
    kind: RefKind | null,
  ): void {
    const rect = p.clientRect?.();
    const query = p.query ?? '';
    const sub = /^([a-z]+)\s/.exec(query);
    const command =
      kind === null && sub ? SLASH_COMMANDS.find((c) => c.command === sub[1]) : undefined;
    const label =
      char === '@'
        ? 'People'
        : char === '#'
          ? 'Assets of this matter'
          : command
            ? `${command.label} of this matter`
            : 'Commands';
    const heading =
      char === '@'
        ? 'Mention a person (no notification)'
        : char === '#'
          ? 'Assets of this matter (type to search)'
          : 'Commands';
    const hint = command
      ? 'type to search; Backspace goes back'
      : char === '/'
        ? 'type to filter, Esc closes'
        : 'Esc closes';
    const previous = this.menu();
    const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 300));
    const below = window.innerHeight - (rect?.bottom ?? 0);
    const above = below < 270 && (rect?.top ?? 0) > below;
    this.menu.set({
      items: p.items,
      index:
        previous && previous.items.length === p.items.length
          ? Math.min(previous.index, p.items.length - 1)
          : 0,
      left,
      top: above ? null : (rect?.bottom ?? 0) + 6,
      bottom: above ? window.innerHeight - (rect?.top ?? 0) + 6 : null,
      label,
      heading,
      crumb: command?.label ?? '',
      hint,
      empty: char === '@' ? 'No one with that name' : 'Nothing matches',
      pick: (item) => p.command(item),
    });
    queueMicrotask(() =>
      document
        .getElementById(`ne-opt-${this.menu()?.index ?? 0}`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }

  private menuKey(p: SuggestionKeyDownProps): boolean {
    const m = this.menu();
    if (!m) return false;
    const e = p.event;
    if (e.key === 'ArrowDown') {
      this.menu.set({ ...m, index: Math.min(m.items.length - 1, m.index + 1) });
      queueMicrotask(() =>
        document
          .getElementById(`ne-opt-${this.menu()?.index}`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
      return true;
    }
    if (e.key === 'ArrowUp') {
      this.menu.set({ ...m, index: Math.max(0, m.index - 1) });
      queueMicrotask(() =>
        document
          .getElementById(`ne-opt-${this.menu()?.index}`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const item = m.items[m.index];
      if (!item) return false;
      m.pick(item);
      return true;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.menu.set(null);
      return true;
    }
    return false;
  }
}
