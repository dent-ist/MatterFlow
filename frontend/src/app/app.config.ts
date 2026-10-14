import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { AuthStore } from './core/auth/auth.store';
import { HttpMeApi, MeApi } from './core/auth/me-api';
import { StubMeApi } from './core/auth/stub-me-api';
import { APP_ENV } from './core/config/app-env';
import { MF_HTTP_INTERCEPTORS } from './core/http/interceptors';
import { MfPreset } from './core/theme/mf-preset';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors(MF_HTTP_INTERCEPTORS)),
    MessageService,
    { provide: APP_ENV, useValue: environment },
    // Provider is chosen by environment.authProvider; the stub needs no backend.
    { provide: MeApi, useClass: environment.authProvider === 'stub' ? StubMeApi : HttpMeApi },
    // Permissions load on first navigation (guards await it) and refresh on window focus (60 s).
    provideAppInitializer(() => {
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
