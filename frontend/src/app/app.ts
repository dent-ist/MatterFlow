import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from 'primeng/toast';
import { DevAuthBanner } from './shared/layout/dev-auth-banner';

/** Root: dev-auth banner (stub provider only), routed content, global toast host. */
@Component({
  selector: 'mf-root',
  imports: [RouterOutlet, Toast, DevAuthBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-dev-auth-banner />
    <router-outlet />
    <p-toast position="top-right" />
  `,
})
export class App {}
