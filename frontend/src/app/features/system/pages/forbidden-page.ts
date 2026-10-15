import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TitleIcon } from '../../../shared/ui/page-header';

@Component({
  selector: 'mf-forbidden-page',
  imports: [RouterLink, TitleIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><mf-title-icon icon="pi pi-ban" />You don't have permission to view this.</h1>
    <p>Ask an administrator if you think you should have access.</p>
    <p><a routerLink="/">Go to my work</a></p>
  `,
})
export class ForbiddenPage {}
