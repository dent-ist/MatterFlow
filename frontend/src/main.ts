import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadBranding } from './app/core/branding/branding';

// The application name and icon are read once before the first render (1.5 s at most, never an error); then the app starts.
loadBranding()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
