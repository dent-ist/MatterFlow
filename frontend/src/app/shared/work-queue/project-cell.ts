import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ZeroDash } from '../ui/zero-dash';

/**
 * The Project cell of a task grid (#265, #1273): the project's name as a link (`mf-link`, underlined) on one line with an ellipsis and the full
 * name as the tooltip, when the viewer may open it (`Project.View`); plain text without that permission. A task without a project shows the
 * standard zero dash with the tooltip "No project". Moving a task to another project is the row menu's "Move to Project...", never a field here.
 */
@Component({
  selector: 'mf-project-cell',
  imports: [RouterLink, ZeroDash],
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
  `,
  template: `
    @if (name(); as n) {
      @if (link() && projectId() !== null) {
        <a
          class="pc mf-link"
          [routerLink]="['/projects', projectId()]"
          [attr.title]="n"
          data-project-link
          >{{ n }}</a
        >
      } @else {
        <span class="pc" [attr.title]="n">{{ n }}</span>
      }
    } @else {
      <span class="pc" title="No project" data-no-project><mf-zero-dash /></span>
    }
  `,
})
export class ProjectCell {
  readonly name = input<string | null | undefined>(null);
  readonly projectId = input<number | null | undefined>(null);
  readonly link = input(false);
}
