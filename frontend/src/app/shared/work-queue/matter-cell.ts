import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatterRef } from '../ui/matter-ref';

/** What the Matter cell needs of a row: a Task Queue row has it, and so does a project (Projects list, WP9). */
export interface MatterCellRow {
  matterId: number;
  matterRef: string;
  matterName: string;
  matterIsActive: boolean;
  clientName: string;
  matterIsSensitive?: boolean | null;
}

/**
 * The Matter cell of the work grids (#197): line 1 the matter reference (a link only when `link` is set, which the table derives from
 * Matter.View) and the sensitive-matter marker; line 2 the matter name, muted, one line with an ellipsis ("(inactive)" appended for an
 * inactive matter). Compact density shows line 1 only. The tooltip of the cell is `Client · Matter name`. The work grids set `nameLine` to
 * false (#348): their Matter Number column shows the reference only, one line, and the name has its own column (`mf-matter-name-cell`).
 */
@Component({
  selector: 'mf-matter-cell',
  imports: [MatterRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.mc-compact]': 'compact()' },
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
      @if (nameLine() && !compact()) {
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
    /* Compact: the 18 px reference link gets a 24 px target without growing the line (WCAG 2.2 2.5.8, #211). */
    :host(.mc-compact) ::ng-deep a.mf-ref {
      padding-block: 3px;
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
  readonly row = input.required<MatterCellRow>();
  /** True for a user with Matter.View: the reference is then a link. */
  readonly link = input(false);
  readonly compact = input(false);
  /** False for the number-only mode of the work grids: the name is the Matter Name column. */
  readonly nameLine = input(true);

  protected readonly tip = computed(() => `${this.row().clientName} · ${this.row().matterName}`);
}

/**
 * The Matter Name cell of the work grids (#348): the matter name on one line with an ellipsis (the full text is the tooltip), "(inactive)"
 * appended for an inactive matter. A link to the matter only when `link` is set (Matter.View), like the Matter Number. The link is a 24 px target.
 */
@Component({
  selector: 'mf-matter-name-cell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (link()) {
      <a class="mn" [routerLink]="['/matters', row().matterId]" [attr.title]="text()">{{
        text()
      }}</a>
    } @else {
      <span class="mn" [attr.title]="text()">{{ text() }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .mn {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 18px;
      padding-block: 3px;
    }
    a.mn {
      color: var(--mf-link);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    a.mn:hover {
      color: var(--mf-primary-hover);
      text-decoration-thickness: 2px;
    }
  `,
})
export class MatterNameCell {
  readonly row =
    input.required<Pick<MatterCellRow, 'matterId' | 'matterName' | 'matterIsActive'>>();
  readonly link = input(false);

  protected readonly text = computed(
    () => `${this.row().matterName}${this.row().matterIsActive ? '' : ' (inactive)'}`,
  );
}
