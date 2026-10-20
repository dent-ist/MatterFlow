import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Type,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LeaveConfirmService } from './shared/guards/unsaved-changes.guard';
import { DevAuthBanner } from './shared/layout/dev-auth-banner';
import { ShellLayout } from './shared/ui/fixed-page';
import { ToastHost } from './shared/ui/toast-host';

/** Root: dev-auth banner (stub provider only), routed content, global toast host and the lazy "Leave without saving?" dialog. */
@Component({
  selector: 'mf-root',
  imports: [RouterOutlet, DevAuthBanner, NgComponentOutlet, ToastHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // While a fixed-header grid page is shown the root is exactly one window tall (styles/_fixed-page.scss), so the dev banner and the shell share it.
  host: { '[class.mf-root--fixed]': 'layout.fixed()' },
  template: `
    <mf-dev-auth-banner />
    <router-outlet />
    <mf-toast-host />
    @if (leaveHost(); as host) {
      <ng-container *ngComponentOutlet="host" />
    }
  `,
})
export class App {
  protected readonly layout = inject(ShellLayout);
  private readonly leaveConfirm = inject(LeaveConfirmService);
  protected readonly leaveHost = signal<Type<unknown> | null>(null);

  constructor() {
    // The dialog (PrimeNG dialog + button) loads the first time a screen asks to be left.
    effect(() => {
      if (!this.leaveConfirm.open() || untracked(this.leaveHost)) return;
      void import('./shared/guards/leave-confirm-host').then((m) =>
        this.leaveHost.set(m.LeaveConfirmHost),
      );
    });
  }
}
