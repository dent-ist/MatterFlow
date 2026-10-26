import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetDispositionChange, AssetsClient } from '../../../api/generated/api-client';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { dispositionLabel } from './asset-disposition';

/**
 * The disposition history of an asset (epic #851, issue #866): who moved it from which state to which, when and why, newest first. It comes from its own endpoint, so a person
 * without `Audit.View` (the History tab) still sees the one thing a project manager needs to explain a disposal. Quiet when the asset never changed.
 */
@Component({
  selector: 'mf-asset-disposition-history',
  imports: [MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .dh {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--mf-s2);
    }
    .dh__row {
      display: grid;
      gap: 2px;
      padding-bottom: var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      overflow-wrap: anywhere;
    }
    .dh__change {
      font-weight: 600;
    }
    .dh__meta,
    .dh__note,
    .dh__none {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    @if (items().length === 0) {
      <p class="dh__none" data-disposition-history-empty>
        {{
          failed()
            ? 'The disposition history could not be loaded.'
            : 'The disposition has not changed.'
        }}
      </p>
    } @else {
      <ol class="dh" data-disposition-history>
        @for (c of items(); track c.auditEventId) {
          <li class="dh__row" data-disposition-change>
            <span class="dh__change">{{ label(c.fromCode) }} to {{ label(c.toCode) }}</span>
            <span class="dh__meta"
              >{{ c.actorName || 'The system' }}, {{ c.occurredAtUtc | mfDate }}</span
            >
            @if (c.note) {
              <span class="dh__note">&ldquo;{{ c.note }}&rdquo;</span>
            }
          </li>
        }
      </ol>
    }
  `,
})
export class AssetDispositionHistory {
  readonly assetId = input.required<number>();
  /** Changes whenever the disposition changes, so the list reloads (the asset's row version or change time). */
  readonly version = input<string | undefined>(undefined);

  private readonly api = inject(AssetsClient);
  protected readonly items = signal<readonly AssetDispositionChange[]>([]);
  protected readonly failed = signal(false);

  constructor() {
    effect(() => {
      const id = this.assetId();
      this.version();
      untracked(() => void this.load(id));
    });
  }

  protected label(code: string): string {
    return dispositionLabel(code);
  }

  private async load(id: number): Promise<void> {
    try {
      const answer = await firstValueFrom(this.api.getAssetDispositionHistory(id));
      this.items.set(answer.items);
      this.failed.set(false);
    } catch {
      this.items.set([]);
      this.failed.set(true);
    }
  }
}
