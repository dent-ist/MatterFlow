import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Tip } from '../../../shared/ui/tip';
import { Tree, TreeNode } from '../../../shared/ui/tree';
import { MatterTree, TreeClient, TreeMatter } from './mm-models';

const EXP_KEY = 'mf-mm-tree-open';

function readOpen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(EXP_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/** The tree nodes of the scope: a client (matters counted) over its matters (open tasks counted, overdue as a warning count, an activity dot, a lock when sensitive). */
export function treeNodes(tree: MatterTree | null, activeOnly: boolean): TreeNode[] {
  if (!tree) return [];
  const matter = (m: TreeMatter): TreeNode => ({
    id: `m:${m.matterId}`,
    label: m.name,
    count: m.openTasks,
    countLabel: 'open tasks',
    alert: m.overdue || null,
    dot: m.isActive ? 'active' : 'quiet',
    lock: m.isSensitive,
  });
  return tree.clients
    .map((c: TreeClient) => {
      const matters = c.matters.filter((m) => !activeOnly || m.isActive);
      return { c, matters };
    })
    .filter((x) => x.matters.length > 0 || !activeOnly)
    .map(({ c, matters }) => ({
      id: `c:${c.clientId}`,
      label: c.name,
      count: matters.length,
      countLabel: 'matters',
      alert: c.overdue || null,
      children: matters.map(matter),
    }));
}

/**
 * The tree of clients and matters (`mf-mm-tree-panel`, epic #953 UI-12): a card with a search box, "Active only", Expand all / Collapse all, a pin that keeps it open after a
 * choice, a button that collapses it to its rail, the legend of the marks and the accessible `mf-tree`. It shows exactly the clients and matters the API returned for the person's
 * scope (a sensitive matter the person may not see is not in the data). The same panel is the Browse popover below 1100 px (`popover`: no pin and no collapse button). The open clients are remembered in the browser.
 */
@Component({
  selector: 'mf-mm-tree-panel',
  imports: [Tree, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.pop]': 'popover()' },
  template: `
    <div class="card">
      <div class="hd">
        <h2 id="mm-tree-h">Clients and matters</h2>
        @if (!popover()) {
          <button
            type="button"
            class="ib"
            data-tree-pin
            [attr.aria-pressed]="pinned()"
            aria-label="Keep the tree open after choosing"
            [mfTip]="
              pinned()
                ? 'Pinned open: the tree stays open after you choose'
                : 'Pin open: keep the tree open after you choose'
            "
            (click)="pin.emit(!pinned())"
          >
            <i
              class="pi"
              [class.pi-lock]="false"
              [class]="pinned() ? 'pi pi-thumbtack' : 'pi pi-thumbtack'"
              aria-hidden="true"
            ></i>
          </button>
          <button
            type="button"
            class="ib"
            data-tree-collapse
            aria-label="Collapse the tree to a thin rail"
            mfTip="Collapse to rail"
            (click)="collapse.emit()"
          >
            <i class="pi pi-angle-double-left" aria-hidden="true"></i>
          </button>
        }
      </div>
      <div class="tools">
        <label class="srch">
          <span class="sr">Search clients and matters</span>
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            type="search"
            data-tree-search
            placeholder="Search clients and matters"
            autocomplete="off"
            [value]="q()"
            (input)="q.set($any($event.target).value)"
          />
        </label>
        <div class="row">
          <label class="chk"
            ><input
              type="checkbox"
              data-tree-active
              [checked]="activeOnly()"
              (change)="activeOnly.set($any($event.target).checked)"
            />
            Active only</label
          >
          <button type="button" class="lnk" data-tree-expand (click)="toggleAll()">
            {{ allOpen() ? 'Collapse all' : 'Expand all' }}
          </button>
        </div>
      </div>
      <div class="body" tabindex="-1">
        @if (nodes().length === 0) {
          <p class="none" role="status">
            {{ q() || activeOnly() ? 'Nothing matches.' : 'No clients or matters in this view.' }}
          </p>
        } @else {
          <mf-tree
            [nodes]="nodes()"
            [selectedId]="selectedId()"
            [expanded]="expanded()"
            (expandedChange)="setExpanded($event)"
            [filter]="q()"
            label="Clients and matters"
            (choose)="onChoose($event)"
          />
        }
      </div>
      <p class="legend">
        <span><span class="d"></span> Active</span>
        <span><span class="d q"></span> Quiet</span>
        <span><i class="pi pi-lock" aria-hidden="true"></i> Sensitive</span>
        <span><i class="pi pi-exclamation-triangle" aria-hidden="true"></i> Overdue</span>
      </p>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 0;
      height: 100%;
      min-width: 0;
    }
    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
      overflow: hidden;
    }
    .hd {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s3) var(--mf-s3) var(--mf-s2) var(--mf-s4);
      flex: none;
    }
    h2 {
      flex: 1;
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .ib {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      cursor: pointer;
    }
    .ib[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
    }
    .tools {
      display: grid;
      gap: var(--mf-s2);
      padding: 0 var(--mf-s3) var(--mf-s2);
      flex: none;
    }
    .srch {
      position: relative;
      display: block;
    }
    .srch .pi {
      position: absolute;
      left: var(--mf-s3);
      top: 50%;
      transform: translateY(-50%);
      color: var(--mf-text-muted);
    }
    .srch input {
      box-sizing: border-box;
      width: 100%;
      min-height: 36px;
      padding: 0 var(--mf-s3) 0 34px;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .chk {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 28px;
    }
    .lnk {
      border: 0;
      background: none;
      padding: 0 var(--mf-s1);
      min-height: 28px;
      color: var(--mf-link);
      font: inherit;
      cursor: pointer;
    }
    .lnk:hover {
      text-decoration: underline;
    }
    .body {
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
      padding: 0 var(--mf-s2) var(--mf-s2);
    }
    .none {
      margin: var(--mf-s4);
      color: var(--mf-text-muted);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s3);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s4);
      border-top: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      flex: none;
    }
    .legend .d {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--mf-active);
      margin-right: 4px;
    }
    .legend .d.q {
      background: transparent;
      border: 2px solid var(--mf-text-muted);
      box-sizing: border-box;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    :host(.pop) .card {
      box-shadow: var(--mf-shadow-pop);
    }
  `,
})
export class MmTreePanel {
  readonly tree = input<MatterTree | null>(null);
  readonly clientId = input<number | null>(null);
  readonly matterId = input<number | null>(null);
  readonly pinned = input(false);
  readonly popover = input(false);
  readonly pin = output<boolean>();
  readonly collapse = output<void>();
  readonly chooseClient = output<number>();
  readonly chooseMatter = output<{ matterId: number; clientId: number }>();

  protected readonly q = signal('');
  protected readonly activeOnly = signal(false);
  protected readonly expanded = signal<ReadonlySet<string>>(readOpen() ?? new Set());
  private seeded = readOpen() !== null;

  protected readonly nodes = computed(() => {
    const nodes = treeNodes(this.tree(), this.activeOnly());
    // First visit: every client with a matter chosen opens, else the first client does, so the tree is never a closed list of clients only.
    if (!this.seeded && nodes.length > 0) {
      this.seeded = true;
      const cid = this.clientId();
      queueMicrotask(() => this.expanded.set(new Set(cid ? [`c:${cid}`] : [nodes[0].id])));
    }
    return nodes;
  });
  protected readonly selectedId = computed(() =>
    this.matterId() ? `m:${this.matterId()}` : this.clientId() ? `c:${this.clientId()}` : null,
  );
  protected readonly allOpen = computed(
    () => this.nodes().length > 0 && this.nodes().every((n) => this.expanded().has(n.id)),
  );

  protected setExpanded(set: ReadonlySet<string>): void {
    this.expanded.set(set);
    try {
      localStorage.setItem(EXP_KEY, JSON.stringify([...set]));
    } catch {
      // Not remembering is fine.
    }
  }

  protected toggleAll(): void {
    this.setExpanded(this.allOpen() ? new Set() : new Set(this.nodes().map((n) => n.id)));
  }

  protected onChoose(id: string): void {
    if (id.startsWith('c:')) {
      this.chooseClient.emit(Number(id.slice(2)));
      return;
    }
    const matterId = Number(id.slice(2));
    const client = this.tree()?.clients.find((c) => c.matters.some((m) => m.matterId === matterId));
    if (client) this.chooseMatter.emit({ matterId, clientId: client.clientId });
  }
}

/**
 * The tree's rail (`mf-mm-tree-rail`): 48 px wide, a button that opens the tree, the current "Client > Matter" written along the rail and a button that clears the choice.
 * The text is the accessible name of the choice, so nothing is carried by position alone.
 */
@Component({
  selector: 'mf-mm-tree-rail',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rail" role="group" aria-label="Clients and matters, collapsed">
      <button
        type="button"
        class="ib"
        data-tree-expand-rail
        aria-label="Show the tree of clients and matters"
        aria-expanded="false"
        mfTip="Show tree"
        (click)="expand.emit()"
      >
        <i class="pi pi-sitemap" aria-hidden="true"></i>
      </button>
      <p class="lab" [attr.title]="label()">
        <span>{{ label() }}</span>
      </p>
      @if (hasChoice()) {
        <button
          type="button"
          class="ib sm"
          data-tree-clear
          aria-label="Clear client and matter"
          mfTip="Clear selection"
          (click)="clear.emit()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 48px;
      height: 100%;
      min-height: 0;
    }
    .rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--mf-s3);
      box-sizing: border-box;
      height: 100%;
      padding: var(--mf-s2) 0 var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-card);
    }
    .ib {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      cursor: pointer;
      flex: none;
    }
    .ib:hover {
      background: var(--mf-surface-alt);
    }
    .ib.sm {
      width: 28px;
      height: 28px;
    }
    .lab {
      flex: 1;
      min-height: 0;
      margin: 0;
      overflow: hidden;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
      font-weight: 600;
    }
  `,
})
export class MmTreeRail {
  readonly label = input('All clients and matters');
  readonly hasChoice = input(false);
  readonly expand = output<void>();
  readonly clear = output<void>();
}
