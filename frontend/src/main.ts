import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadBranding } from './app/core/branding/branding';

// The application name and icon: the last known copy is applied synchronously inside loadBranding(), the server's answer (1.5 s at most, never an
// error) follows and updates the header, the title and the icon links reactively. The app starts at once, exactly when it did before branding existed.
void loadBranding();
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
