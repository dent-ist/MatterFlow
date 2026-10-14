import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from 'primeng/toast';
import { LeaveConfirmHost } from './shared/guards/leave-confirm-host';
import { LeaveConfirmService } from './shared/guards/unsaved-changes.guard';
import { DevAuthBanner } from './shared/layout/dev-auth-banner';

/** Root: dev-auth banner (stub provider only), routed content, global toast host. */
@Component({
  selector: 'mf-root',
  imports: [RouterOutlet, Toast, DevAuthBanner, LeaveConfirmHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-dev-auth-banner />
    <router-outlet />
    <p-toast position="bottom-right" />
    @defer (when leaveConfirm.open()) {
      <mf-leave-confirm-host />
    }
  `,
})
export class App {
  protected readonly leaveConfirm = inject(LeaveConfirmService);
}
