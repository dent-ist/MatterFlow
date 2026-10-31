import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

export interface TreeNode {
  id: string;
  label: string;
  children?: readonly TreeNode[];
  /** A number drawn after the label (matters of a client, open tasks of a matter) and read after it. */
  count?: number | null;
  /** What `count` counts, for screen readers ("matters", "open tasks"). */
  countLabel?: string;
  /** A red warning count (overdue tasks); drawn with an icon and read as "n overdue". */
  alert?: number | null;
  /** The activity dot: a filled one for an active matter, a hollow one for a quiet matter. Both are also written for screen readers. */
  dot?: 'active' | 'quiet' | null;
  /** The matter is sensitive: a lock icon and the word for screen readers (drawn from the flag the API returns, never guessed). */
  lock?: boolean;
}

interface Row {
  node: TreeNode;
  level: number;
  setSize: number;
  pos: number;
  parentId: string | null;
  open: boolean | null;
}

/** Case-insensitive match of a label; the search of the tree. A parent stays when any child matches, and a matching parent shows all its children. */
export function filterTree(nodes: readonly TreeNode[], text: string): TreeNode[] {
  const q = text.trim().toLowerCase();
  if (!q) return [...nodes];
  const walk = (list: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of list) {
      if (n.label.toLowerCase().includes(q)) out.push(n);
      else if (n.children?.length) {
        const kids = walk(n.children);
        if (kids.length) out.push({ ...n, children: kids });
      }
    }
    return out;
  };
  return walk(nodes);
}

/**
 * Accessible tree (`mf-tree`, epic #953 UI-10; the client / matter tree of My Matters). A WAI-ARIA tree pattern: `role="tree"` with flat `treeitem`s carrying `aria-level`,
 * `aria-setsize`, `aria-posinset`, `aria-expanded` (parents) and `aria-selected`. One tab stop (roving tabindex). Keys: Up and Down move, Right opens a closed parent or goes to its first
 * child, Left closes an open parent or goes to the parent, Home and End jump, Enter and Space choose, `*` opens every sibling parent, and typing a letter jumps to the next label that starts
 * with it (type-ahead; the keys are widget navigation inside the tree, not global shortcuts). With `filter` set the tree shows only the matching nodes with their parents open. The tree
 * shows exactly the nodes it is given: what a person may not see is not in the data (sensitive matters are filtered by the API).
 */
@Component({
  selector: 'mf-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKey($event)',
    '(click)': 'onClick($event)',
    '(focusin)': 'onFocusIn($event)',
  },
  template: `
    <ul class="tree" role="tree" [attr.aria-label]="label()">
      @for (r of rows(); track r.node.id) {
        <li
          role="treeitem"
          class="item"
          [class.sel]="r.node.id === selectedId()"
          [attr.data-id]="r.node.id"
          [attr.aria-level]="r.level"
          [attr.aria-setsize]="r.setSize"
          [attr.aria-posinset]="r.pos"
          [attr.aria-expanded]="r.open"
          [attr.aria-selected]="r.node.id === selectedId()"
          [attr.aria-label]="name(r)"
          [attr.tabindex]="r.node.id === tabStop() ? 0 : -1"
          [style.--lvl]="r.level - 1"
        >
          @if (r.open !== null) {
            <span class="chev" data-chev aria-hidden="true">
              <i class="pi" [class]="r.open ? 'pi-angle-down' : 'pi-angle-right'"></i>
            </span>
          } @else {
            <span class="chev" aria-hidden="true"></span>
          }
          @if (r.node.dot) {
            <span class="dot" [class.quiet]="r.node.dot === 'quiet'" aria-hidden="true"></span>
          }
          <span class="lbl" aria-hidden="true">{{ r.node.label }}</span>
          @if (r.node.lock) {
            <i class="pi pi-lock lock" aria-hidden="true"></i>
          }
          @if (r.node.alert) {
            <span class="alert" aria-hidden="true"
              ><i class="pi pi-exclamation-triangle"></i>{{ r.node.alert }}</span
            >
          }
          @if ((r.node.count ?? -1) >= 0) {
            <span class="cnt" aria-hidden="true">{{ r.node.count }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .tree {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: 2px var(--mf-s2) 2px calc(var(--mf-s2) + var(--lvl, 0) * var(--mf-s5));
      border-radius: var(--mf-radius-lg, 8px);
      color: var(--mf-text);
      cursor: pointer;
      font-size: var(--mf-fs-sm);
    }
    .item:hover {
      background: var(--mf-surface-alt);
    }
    .item.sel {
      background: var(--mf-selected-bg);
      font-weight: 700;
    }
    .item:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .chev {
      display: inline-grid;
      place-items: center;
      width: 18px;
      flex: none;
      color: var(--mf-text-muted);
    }
    .dot {
      width: 9px;
      height: 9px;
      flex: none;
      border-radius: 50%;
      background: var(--mf-active, var(--mf-success));
    }
    .dot.quiet {
      background: transparent;
      border: 2px solid var(--mf-text-muted);
      box-sizing: border-box;
    }
    .lbl {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lock {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .alert {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      flex: none;
      color: var(--mf-due-overdue);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .cnt {
      flex: none;
      min-width: 22px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--mf-surface-alt);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    @media (max-width: 767.98px) {
      .item {
        min-height: 44px;
      }
    }
  `,
})
export class Tree {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly nodes = input.required<readonly TreeNode[]>();
  readonly label = input('Clients and matters');
  readonly selectedId = input<string | null>(null);
  /** The ids of the open parents. A search opens the parents of what it found without changing this set. */
  readonly expanded = model<ReadonlySet<string>>(new Set());
  readonly filter = input('');
  /** The user chose a node (click, Enter or Space). */
  readonly choose = output<string>();

  protected readonly active = signal<string | null>(null);
  private typed = '';
  private typedAt = 0;

  private readonly shown = computed(() => filterTree(this.nodes(), this.filter()));
  protected readonly rows = computed<Row[]>(() => {
    const forced = this.filter().trim() !== '';
    const open = this.expanded();
    const out: Row[] = [];
    const walk = (list: readonly TreeNode[], level: number, parentId: string | null): void => {
      list.forEach((node, i) => {
        const isParent = !!node.children?.length;
        const isOpen = isParent ? forced || open.has(node.id) : null;
        out.push({ node, level, setSize: list.length, pos: i + 1, parentId, open: isOpen });
        if (isParent && isOpen) walk(node.children!, level + 1, node.id);
      });
    };
    walk(this.shown(), 1, null);
    return out;
  });
  /** The one tab stop: the focused row, else the chosen row, else the first. */
  protected readonly tabStop = computed(() => {
    const rows = this.rows();
    const ids = new Set(rows.map((r) => r.node.id));
    const a = this.active();
    if (a && ids.has(a)) return a;
    const s = this.selectedId();
    if (s && ids.has(s)) return s;
    return rows[0]?.node.id ?? null;
  });

  /** The accessible name of a row: the label, then what the marks mean, so nothing rests on colour or an icon. */
  protected name(r: Row): string {
    const n = r.node;
    const parts = [n.label];
    if (n.lock) parts.push('sensitive matter');
    if (n.dot) parts.push(n.dot === 'active' ? 'active' : 'quiet');
    if (n.alert) parts.push(`${n.alert} overdue`);
    if (n.count != null) parts.push(`${n.count} ${n.countLabel ?? ''}`.trim());
    return parts.join(', ');
  }

  private rowOf(event: Event): Row | null {
    const li = (event.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
    const id = li?.dataset['id'];
    return this.rows().find((r) => r.node.id === id) ?? null;
  }

  protected onFocusIn(event: FocusEvent): void {
    const r = this.rowOf(event);
    if (r) this.active.set(r.node.id);
  }

  protected onClick(event: MouseEvent): void {
    const r = this.rowOf(event);
    if (!r) return;
    if ((event.target as HTMLElement).closest('[data-chev]') && r.open !== null) {
      this.toggle(r.node.id);
      return;
    }
    this.active.set(r.node.id);
    this.choose.emit(r.node.id);
  }

  private toggle(id: string, to?: boolean): void {
    const next = new Set(this.expanded());
    const want = to ?? !next.has(id);
    if (want) next.add(id);
    else next.delete(id);
    this.expanded.set(next);
  }

  private focusRow(id: string | null): void {
    if (!id) return;
    this.active.set(id);
    queueMicrotask(() => {
      const items = Array.from(this.host.querySelectorAll<HTMLElement>('[role=treeitem]'));
      items.find((el) => el.dataset['id'] === id)?.focus();
    });
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const rows = this.rows();
    const i = rows.findIndex((r) => r.node.id === this.tabStop());
    const cur = rows[i];
    if (!cur) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(rows[Math.min(rows.length - 1, i + 1)].node.id);
        break;
      case 'ArrowUp':
        this.focusRow(rows[Math.max(0, i - 1)].node.id);
        break;
      case 'Home':
        this.focusRow(rows[0].node.id);
        break;
      case 'End':
        this.focusRow(rows[rows.length - 1].node.id);
        break;
      case 'ArrowRight':
        if (cur.open === false) this.toggle(cur.node.id, true);
        else if (cur.open) this.focusRow(rows[i + 1]?.node.id ?? null);
        break;
      case 'ArrowLeft':
        if (cur.open && this.filter().trim() === '') this.toggle(cur.node.id, false);
        else if (cur.parentId) this.focusRow(cur.parentId);
        break;
      case 'Enter':
      case ' ':
        this.choose.emit(cur.node.id);
        break;
      case '*': {
        const next = new Set(this.expanded());
        rows
          .filter((r) => r.parentId === cur.parentId && r.open !== null)
          .forEach((r) => next.add(r.node.id));
        this.expanded.set(next);
        break;
      }
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) this.typeAhead(event.key, rows, i);
        else handled = false;
    }
    if (handled) event.preventDefault();
  }

  private typeAhead(key: string, rows: Row[], from: number): void {
    const now = Date.now();
    this.typed = now - this.typedAt > 700 ? key.toLowerCase() : this.typed + key.toLowerCase();
    this.typedAt = now;
    const same = this.typed.split('').every((c) => c === this.typed[0]);
    const start = this.typed.length === 1 || same ? from + 1 : from;
    const needle = same ? this.typed[0] : this.typed;
    for (let k = 0; k < rows.length; k++) {
      const row = rows[(start + k) % rows.length];
      if (row.node.label.toLowerCase().startsWith(needle)) {
        this.focusRow(row.node.id);
        return;
      }
    }
  }
}
