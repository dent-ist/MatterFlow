import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withNavigationErrorHandler,
} from '@angular/router';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { AuthStore } from './core/auth/auth.store';
import { HttpMeApi, MeApi } from './core/auth/me-api';
import { StubMeApi } from './core/auth/stub-me-api';
import { APP_ENV } from './core/config/app-env';
import { HttpIdentityAdminApi } from './core/identity-admin/http-identity-admin-api';
import { IdentityAdminApi } from './core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from './core/identity-admin/in-memory-identity-admin-api';
import { MF_HTTP_INTERCEPTORS } from './core/http/interceptors';
import { handleNavigationError } from './shared/layout/nav-error';
import { MfPreset } from './core/theme/mf-preset';
import { suppressImplicitAutofocus } from './core/theme/no-autofocus';
import { MfTitleStrategy } from './core/title/page-title';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withNavigationErrorHandler(handleNavigationError),
    ),
    provideHttpClient(withInterceptors(MF_HTTP_INTERCEPTORS)),
    { provide: TitleStrategy, useExisting: MfTitleStrategy },
    MessageService,
    { provide: APP_ENV, useValue: environment },
    // Provider is chosen by environment.authProvider; the stub needs no backend.
    { provide: MeApi, useClass: environment.authProvider === 'stub' ? StubMeApi : HttpMeApi },
    // Users/roles administration: real API, or in-memory data while running with the stub auth provider.
    {
      provide: IdentityAdminApi,
      useClass:
        environment.authProvider === 'stub' ? InMemoryIdentityAdminApi : HttpIdentityAdminApi,
    },
    // Permissions load on first navigation (guards await it) and refresh on window focus (60 s).
    provideAppInitializer(() => {
      suppressImplicitAutofocus();
      inject(AuthStore).startFocusRefresh();
    }),
    providePrimeNG({
      theme: {
        preset: MfPreset,
        // Phase 1 is light-theme only (docs/ux/tokens.css).
        options: { darkModeSelector: false, cssLayer: false },
      },
    }),
  ],
};
