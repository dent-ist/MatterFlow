import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatterRefParts, formatMatterRef } from '../pipes/matter-ref.pipe';
import { CopyButton } from './copy-button';

/**
 * Monospace `00343-00012` (optionally linking to the Matter) with a copy button (UX `mf-matter-ref`, UXR-13). The link uses the
 * themed `--mf-link` colour (not the browser default blue) on every screen; set `copy` to false where a copy button is noise.
 */
@Component({
  selector: 'mf-matter-ref',
  imports: [RouterLink, CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ref(); as r) {
      @if (link()) {
        <a class="mf-ref" [routerLink]="link()" [attr.title]="hint()">{{ r }}</a>
      } @else {
        <span class="mf-ref">{{ r }}</span>
      }
      @if (copy()) {
        <mf-copy-button [text]="r" label="matter number" [rowStop]="rowStop()" />
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .mf-ref {
      font-family: var(--mf-font-mono);
      font-weight: 400;
      /* The reference never breaks at its hyphen (BUG-6): a narrow table gives the Name column way, not this. The copy button is a
         sibling and keeps its own wrapping rules. */
      white-space: nowrap;
    }
    a.mf-ref {
      color: var(--mf-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    a.mf-ref:hover {
      color: var(--mf-primary-hover);
      text-decoration-thickness: 2px;
    }
  `,
})
export class MatterRef {
  readonly value = input.required<MatterRefParts | string | null | undefined>();
  /** Router commands to Matter detail, when known. */
  readonly link = input<string | unknown[] | null>(null);
  /** Tooltip on the link, for example the Matter name. */
  readonly hint = input<string | null>(null);
  /** Show the copy button (default). */
  readonly copy = input(true);
  /** The copy button belongs to a list row: not a Tab stop of its own, shown on hover and focus (see `mf-copy-button`). */
  readonly rowStop = input(false);

  protected readonly ref = computed(() => formatMatterRef(this.value()));
}
