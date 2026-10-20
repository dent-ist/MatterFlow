import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { ErrorReferenceStore } from '../../core/http/error-reference-store';
import { CopyButton } from './copy-button';

/** "Reference: abc-123  [Copy]" line for the inline error alert; renders nothing when the server sent no reference. */
@Component({
  selector: 'mf-error-reference',
  imports: [CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as ref) {
      <span class="mf-errref" data-error-reference>
        Reference: <code>{{ ref }}</code>
        <mf-copy-button [text]="ref" label="reference" [showText]="true" />
      </span>
    }
  `,
  styles: `
    :host {
      display: block;
      margin-top: var(--mf-s1);
      font-size: var(--mf-fs-sm);
    }
    .mf-errref {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    code {
      font-family: var(--mf-font-mono);
      user-select: all;
    }
  `,
})
export class ErrorReference {
  protected readonly store = inject(ErrorReferenceStore);
  /** An explicit reference (an error that did not come through the HTTP layer); by default the last one the server sent. */
  readonly reference = input<string | null>(null);
  protected readonly shown = computed(() => this.reference() || this.store.reference());

  constructor() {
    this.store.claim();
    effect(() => {
      this.store.reference();
      this.store.claim();
    });
  }
}
