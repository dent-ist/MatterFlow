import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TaskQueueRow } from '../../api/generated/api-client';
import { MatterRef } from '../ui/matter-ref';

/**
 * The Matter cell of the work grids (#197): line 1 the matter reference (a link only when `link` is set, which the table derives from
 * Matter.View) and the sensitive-matter marker; line 2 the matter name, muted, one line with an ellipsis ("(inactive)" appended for an
 * inactive matter). Compact density shows line 1 only. The tooltip of the cell is `Client · Matter name`.
 */
@Component({
  selector: 'mf-matter-cell',
  imports: [MatterRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mc" [attr.title]="tip()">
      <div class="mc-ref">
        <mf-matter-ref
          [value]="row().matterRef"
          [link]="link() ? ['/matters', row().matterId] : null"
          [copy]="false"
        />
        @if (row().matterIsSensitive) {
          <i
            class="pi pi-exclamation-triangle mc-sensitive"
            role="img"
            aria-label="Sensitive matter"
          ></i>
        }
      </div>
      @if (!compact()) {
        <div class="mc-name" data-matter-name>
          <span class="mf-sr-only">, </span>{{ row().matterName
          }}{{ row().matterIsActive ? '' : ' (inactive)' }}
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .mc {
      min-width: 0;
    }
    .mc-ref {
      display: flex;
      align-items: center;
      line-height: 18px;
      white-space: nowrap;
    }
    .mc-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mf-text-muted);
      font-size: 12px;
      line-height: 16px;
    }
    .mc-sensitive {
      margin-left: var(--mf-s1);
      color: var(--mf-warning);
    }
    .mf-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class MatterCell {
  readonly row = input.required<TaskQueueRow>();
  /** True for a user with Matter.View: the reference is then a link. */
  readonly link = input(false);
  readonly compact = input(false);

  protected readonly tip = computed(() => `${this.row().clientName} · ${this.row().matterName}`);
}
