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
import { MatterTree } from './mm-models';
import { MmTreePanel } from './tree-panel';

/**
 * The row under the title (`mf-mm-scope-bar`): the Scope button (the Client and Matters tree as a panel or, on a phone, a sheet, where the tree is not docked) and the slot at the
 * right for the options menu and "+ New". The client and matter are chosen in the tree only (MM-20, #1053); the chosen scope is the chip beside the title.
 */
@Component({
  selector: 'mf-mm-scope-bar',
  imports: [MmTreePanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sel">
      @if (showBrowse()) {
        <div class="browse">
          <button
            type="button"
            class="mf-btn"
            data-browse
            aria-haspopup="dialog"
            [attr.aria-expanded]="browsing()"
            (click)="browsing.set(!browsing())"
          >
            <i class="pi pi-sitemap" aria-hidden="true"></i><span>Scope</span>
          </button>
          @if (browsing()) {
            <div
              class="pop"
              role="dialog"
              aria-label="Client and Matters"
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
      /* A phone: the tree opens as a sheet from the bottom of the window. */
      .pop {
        position: fixed;
        top: auto;
        left: var(--mf-s2);
        right: var(--mf-s2);
        bottom: var(--mf-s2);
        width: auto;
        height: min(80dvh, 560px);
        z-index: 60;
      }
      :host {
        flex-direction: column;
        align-items: stretch;
      }
      .sel {
        flex-direction: column;
        align-items: stretch;
        flex-wrap: wrap;
      }
      .mf-btn {
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
  /** A client row of the Browse tree: always selects the client and clears the matter. */
  readonly pickedClientNode = output<number>();
  readonly pickedMatter = output<{ matterId: number | null; clientId: number | null }>();

  protected readonly browsing = signal(false);
  protected readonly showBrowse = computed(
    () => !this.docked() && (this.tree()?.matterCount ?? 0) > 1,
  );

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
