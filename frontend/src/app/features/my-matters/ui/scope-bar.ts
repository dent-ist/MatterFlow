import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { MatterTree } from './mm-models';
import { MmTreePanel } from './tree-panel';

/**
 * The row under the title (`mf-mm-scope-bar`, epic #953 UI-11): the Client and Matter dropdowns, Browse (the tree as a panel where it is not docked), Clear, and the slot at the
 * right for "+ New". The two dropdowns are searchable comboboxes over the same tree data as the tree: picking a matter sets its client; the Matter list narrows to the chosen
 * client; picking a client that does not own the chosen matter drops the matter. With one matter (or none) the tree and Browse are not offered (nothing to browse).
 */
@Component({
  selector: 'mf-mm-scope-bar',
  imports: [Dropdown, MmTreePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sel" role="group" aria-label="Client and matter">
      <div class="dd">
        <mf-dropdown
          buttonId="mm-client"
          label="Client"
          icon="pi-building"
          [items]="clientItems()"
          [value]="clientValue()"
          (valueChange)="pickClient($event)"
          [search]="true"
          searchLabel="Search clients"
          [limit]="60"
          [panelWidth]="320"
        />
      </div>
      <div class="dd">
        <mf-dropdown
          buttonId="mm-matter"
          label="Matter"
          icon="pi-briefcase"
          [items]="matterItems()"
          [value]="matterValue()"
          (valueChange)="pickMatter($event)"
          [search]="true"
          searchLabel="Search matters"
          [limit]="60"
          [panelWidth]="440"
        />
      </div>
      @if (showBrowse()) {
        <div class="browse">
          <button
            type="button"
            class="btn"
            data-browse
            aria-haspopup="dialog"
            [attr.aria-expanded]="browsing()"
            (click)="browsing.set(!browsing())"
          >
            <i class="pi pi-sitemap" aria-hidden="true"></i><span>Browse</span>
          </button>
          @if (browsing()) {
            <div
              class="pop"
              role="dialog"
              aria-label="Browse clients and matters"
              (keydown.escape)="closeBrowse(true)"
            >
              <mf-mm-tree-panel
                [popover]="true"
                [tree]="tree()"
                [clientId]="clientId()"
                [matterId]="matterId()"
                (chooseClient)="chosenClient($event)"
                (chooseMatter)="chosenMatter($event)"
              />
            </div>
          }
        </div>
      }
      @if (clientId() || matterId()) {
        <button type="button" class="clr" data-clear-scope (click)="clear.emit()">Clear</button>
      }
    </div>
    <div class="new"><ng-content /></div>
  `,
  host: { '(document:mousedown)': 'outside($event)', '(keydown.escape)': 'escape()' },
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .sel {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: var(--mf-s3);
      flex: 1 1 auto;
      min-width: 0;
    }
    .dd {
      flex: 0 1 280px;
      min-width: 140px;
    }
    .dd mf-dropdown {
      display: block;
    }
    .btn,
    .clr {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 36px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .clr {
      border: 0;
      background: none;
      color: var(--mf-link);
    }
    .clr:hover {
      text-decoration: underline;
    }
    .browse {
      flex: none;
    }
    .pop {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 60;
      width: min(380px, calc(100vw - 32px));
      height: min(520px, 70dvh);
    }
    .new {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-left: auto;
      flex: none;
    }
    @media (max-width: 767.98px) {
      :host {
        flex-direction: column;
        align-items: stretch;
      }
      .sel {
        flex-direction: column;
        align-items: stretch;
        flex-wrap: wrap;
      }
      .dd {
        flex: none;
        width: 100%;
      }
      .btn,
      .clr {
        min-height: 44px;
        justify-content: center;
      }
      .new {
        margin-left: 0;
      }
      .new ::ng-deep button {
        width: 100%;
      }
    }
  `,
})
export class MmScopeBar {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly tree = input<MatterTree | null>(null);
  readonly clientId = input<number | null>(null);
  readonly matterId = input<number | null>(null);
  /** The docked tree is shown: Browse is not needed. */
  readonly docked = input(false);
  readonly pickedClient = output<number | null>();
  /** A client row of the Browse tree: always selects the client and clears the matter. */
  readonly pickedClientNode = output<number>();
  readonly pickedMatter = output<{ matterId: number | null; clientId: number | null }>();
  readonly clear = output<void>();

  protected readonly browsing = signal(false);
  protected readonly showBrowse = computed(
    () => !this.docked() && (this.tree()?.matterCount ?? 0) > 1,
  );

  protected readonly clientValue = computed(() => (this.clientId() ? String(this.clientId()) : ''));
  protected readonly matterValue = computed(() => (this.matterId() ? String(this.matterId()) : ''));
  protected readonly clientItems = computed<DropdownItem[]>(() => [
    { value: '', label: 'All clients', count: this.tree()?.matterCount ?? 0 },
    ...(this.tree()?.clients ?? []).map((c) => ({
      value: String(c.clientId),
      label: c.name,
      count: c.matters.length,
    })),
  ]);
  protected readonly matterItems = computed<DropdownItem[]>(() => {
    const cid = this.clientId();
    const rows: DropdownItem[] = [];
    for (const c of this.tree()?.clients ?? []) {
      if (cid && c.clientId !== cid) continue;
      for (const m of c.matters)
        rows.push({
          value: String(m.matterId),
          label: m.name,
          sub: cid ? m.matterRef : `${c.name} · ${m.matterRef}`,
          dot: m.isActive ? 'active' : 'quiet',
          lock: m.isSensitive,
        });
    }
    return [
      {
        value: '',
        label: 'All matters',
        count: rows.length,
        sub: cid ? undefined : 'Every matter you manage',
      },
      ...rows,
    ];
  });

  protected pickClient(v: string): void {
    const id = v ? Number(v) : null;
    if (id === this.clientId()) return;
    this.pickedClient.emit(id);
  }

  protected pickMatter(v: string): void {
    const id = v ? Number(v) : null;
    if (id === this.matterId()) return;
    if (id === null) {
      this.pickedMatter.emit({ matterId: null, clientId: this.clientId() });
      return;
    }
    const c = this.tree()?.clients.find((x) => x.matters.some((m) => m.matterId === id));
    this.pickedMatter.emit({ matterId: id, clientId: c?.clientId ?? null });
  }

  protected chosenClient(id: number): void {
    this.closeBrowse(true);
    this.pickedClientNode.emit(id);
  }

  protected chosenMatter(e: { matterId: number; clientId: number }): void {
    this.closeBrowse(true);
    this.pickedMatter.emit(e);
  }

  protected closeBrowse(restore: boolean): void {
    this.browsing.set(false);
    if (restore)
      queueMicrotask(() => this.host.querySelector<HTMLElement>('[data-browse]')?.focus());
  }

  protected escape(): void {
    if (this.browsing()) this.closeBrowse(true);
  }

  protected outside(e: MouseEvent): void {
    if (this.browsing() && !(e.target as HTMLElement).closest('.browse')) this.browsing.set(false);
  }
}
