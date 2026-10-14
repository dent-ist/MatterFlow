import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'mf-forbidden-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>You don't have permission to view this.</h1>
    <p>Ask an administrator if you think you should have access.</p>
    <p><a routerLink="/">Go to my work</a></p>
  `,
})
export class ForbiddenPage {}
