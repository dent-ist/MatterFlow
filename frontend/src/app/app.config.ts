import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { timeZoneInterceptor } from './core/http/time-zone.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([timeZoneInterceptor])),
    providePrimeNG({
      theme: {
        preset: Aura,
        // Phase 1 is light-theme only (docs/ux/tokens.css).
        options: { darkModeSelector: false, cssLayer: false },
      },
    }),
  ],
};
