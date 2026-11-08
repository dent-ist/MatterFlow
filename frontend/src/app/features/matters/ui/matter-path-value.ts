import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { isWebAddress } from '../../../shared/forms/matter-paths';
import { CopyButton } from '../../../shared/ui/copy-button';
import { Tip } from '../../../shared/ui/tip';

/**
 * The value of a DMS Path or DFS Path on the Matter Summary (epic #1298, UI spec 2.3 and 2.4): the value at the left and the Copy button at the right.
 * A web address (`http://` or `https://`) is a link in the mono font that opens in a new tab; a UNC path is plain selectable mono text (a browser opens no
 * UNC link from a page); an empty value is the muted "Not set" with no button. A path has no spaces to wrap on, so it wraps anywhere and is clamped to
 * two lines; the full text is the tooltip and is always what Copy puts on the clipboard. No toast on Copy: the button itself says "Copied".
 */
@Component({
  selector: 'mf-matter-path-value',
  imports: [CopyButton, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .pv {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
    }
    .pv__text {
      flex: 1 1 auto;
      min-width: 0;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
      overflow-wrap: anywhere;
      font-family: var(--mf-font-mono);
      user-select: text;
    }
    /* The clamp is on the anchor itself, so its clipped lines are not laid out outside the box (axe target-size next to the PM "Add" button, #1310). */
    .pv__text a {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      max-width: 100%;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .pv__icon {
      flex: none;
      margin-top: 0.3rem;
      font-size: var(--mf-icon-xs);
      color: var(--mf-link);
    }
    .pv mf-copy-button {
      flex: none;
      white-space: nowrap;
    }
    .pv__none {
      color: var(--mf-text-muted);
    }
  `,
  template: `
    @if (value(); as v) {
      <div class="pv" data-path-row>
        <span class="pv__text" [mfTip]="v" data-path-text>
          @if (web()) {
            <a
              class="mf-link"
              [attr.href]="v"
              target="_blank"
              rel="noopener noreferrer"
              data-path-link
              >{{ v }}<span class="mf-sr-only"> (opens in a new tab)</span></a
            >
          } @else {
            <span data-path-unc>{{ v }}</span>
          }
        </span>
        @if (web()) {
          <i class="pi pi-external-link pv__icon" aria-hidden="true"></i>
        }
        <mf-copy-button [text]="v" [label]="label()" [showText]="true" />
      </div>
    } @else {
      <span class="pv__none" data-path-none>Not set</span>
    }
  `,
})
export class MatterPathValue {
  /** The visible field label ("DMS Path"): the Copy button's accessible name is "Copy DMS Path". */
  readonly label = input.required<string>();
  readonly value = input<string | null | undefined>(null);
  protected readonly web = computed(() => isWebAddress(this.value()));
}
