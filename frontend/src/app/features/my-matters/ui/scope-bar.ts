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
import { PickerOption } from '../../../shared/ui/entity-picker';
import { SearchSelect } from '../../../shared/ui/search-select';
import { MatterTree } from './mm-models';
import { MmTreePanel } from './tree-panel';

/**
 * The row under the title (`mf-mm-scope-bar`, epic #953 UI-11): the Client and Matter dropdowns, Browse (the tree as a panel where it is not docked), Clear, and the slot at the
 * right for "+ New". The two dropdowns are searchable comboboxes over the same tree data as the tree: picking a matter sets its client; the Matter list narrows to the chosen
 * client; picking a client that does not own the chosen matter drops the matter. With one matter (or none) the tree and Browse are not offered (nothing to browse).
 */
@Component({
  selector: 'mf-mm-scope-bar',
  imports: [SearchSelect, MmTreePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sel" role="group" aria-label="Client and matter">
      <div class="dd">
        <mf-search-select
          label="Client"
          [hideLabel]="true"
          inputId="mm-client"
          allLabel="All clients"
          [options]="clientOptions()"
          [selected]="client()"
          (selectedChange)="pickClient($event)"
        />
      </div>
      <div class="dd">
        <mf-search-select
          label="Matter"
          [hideLabel]="true"
          inputId="mm-matter"
          allLabel="All matters"
          [options]="matterOptions()"
          [selected]="matter()"
          (selectedChange)="pickMatter($event)"
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
  readonly pickedMatter = output<{ matterId: number | null; clientId: number | null }>();
  readonly clear = output<void>();

  protected readonly browsing = signal(false);
  protected readonly showBrowse = computed(
    () => !this.docked() && (this.tree()?.matterCount ?? 0) > 1,
  );

  protected readonly clientOptions = computed<PickerOption[]>(() =>
    (this.tree()?.clients ?? []).map((c) => ({ id: c.clientId, label: c.name })),
  );
  protected readonly matterOptions = computed<PickerOption[]>(() => {
    const cid = this.clientId();
    const out: PickerOption[] = [];
    for (const c of this.tree()?.clients ?? []) {
      if (cid && c.clientId !== cid) continue;
      for (const m of c.matters)
        out.push({
          id: m.matterId,
          label: cid ? m.name : `${m.name} (${c.name})`,
          flag: m.isSensitive ? 'Sensitive matter' : undefined,
        });
    }
    return out;
  });
  protected readonly client = computed(
    () => this.clientOptions().find((o) => o.id === this.clientId()) ?? null,
  );
  protected readonly matter = computed(() => {
    const id = this.matterId();
    if (!id) return null;
    for (const c of this.tree()?.clients ?? []) {
      const m = c.matters.find((x) => x.matterId === id);
      if (m) return { id, label: m.name } as PickerOption;
    }
    return null;
  });

  protected pickClient(o: PickerOption | null): void {
    if ((o?.id ?? null) === this.clientId()) return;
    this.pickedClient.emit(o?.id ?? null);
  }

  protected pickMatter(o: PickerOption | null): void {
    if ((o?.id ?? null) === this.matterId()) return;
    if (!o) {
      this.pickedMatter.emit({ matterId: null, clientId: this.clientId() });
      return;
    }
    const c = this.tree()?.clients.find((x) => x.matters.some((m) => m.matterId === o.id));
    this.pickedMatter.emit({ matterId: o.id, clientId: c?.clientId ?? null });
  }

  protected chosenClient(id: number): void {
    this.closeBrowse(true);
    this.pickedClient.emit(id);
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
