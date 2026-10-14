import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatterRefParts, formatMatterRef } from '../pipes/matter-ref.pipe';
import { CopyButton } from './copy-button';

/** Monospace `00343-00012` (optionally linking to the Matter) with a copy button (UX `mf-matter-ref`). */
@Component({
  selector: 'mf-matter-ref',
  imports: [RouterLink, CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ref(); as r) {
      @if (link()) {
        <a class="mf-ref" [routerLink]="link()">{{ r }}</a>
      } @else {
        <span class="mf-ref">{{ r }}</span>
      }
      <mf-copy-button [text]="r" label="matter number" />
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
    }
  `,
})
export class MatterRef {
  readonly value = input.required<MatterRefParts | string | null | undefined>();
  /** Router commands to Matter detail, when known. */
  readonly link = input<string | unknown[] | null>(null);

  protected readonly ref = computed(() => formatMatterRef(this.value()));
}
