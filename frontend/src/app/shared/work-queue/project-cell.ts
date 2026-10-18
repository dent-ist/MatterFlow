import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The Project cell of a Matter's Tasks grid (#265): the project's name on one line with an ellipsis, the full name as the tooltip, and a
 * link to the project when the viewer may open it (`Project.View`). A task without a project shows a dash.
 */
@Component({
  selector: 'mf-project-cell',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .pc {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    a.pc {
      color: var(--mf-link);
    }
  `,
  template: `
    @if (name(); as n) {
      @if (link() && projectId() !== null) {
        <a
          class="pc"
          [routerLink]="['/projects', projectId()]"
          [attr.title]="n"
          data-project-link
          >{{ n }}</a
        >
      } @else {
        <span class="pc" [attr.title]="n">{{ n }}</span>
      }
    } @else {
      <span class="pc">-</span>
    }
  `,
})
export class ProjectCell {
  readonly name = input<string | null | undefined>(null);
  readonly projectId = input<number | null | undefined>(null);
  readonly link = input(false);
}
