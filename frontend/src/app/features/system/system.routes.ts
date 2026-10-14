import { Routes } from '@angular/router';
import { ForbiddenPage } from './pages/forbidden-page';
import { NotFoundPage } from './pages/not-found-page';

/** Routes rendered inside the app shell. */
export const SYSTEM_ROUTES: Routes = [
  { path: '403', component: ForbiddenPage },
  { path: '404', component: NotFoundPage },
  { path: '**', component: NotFoundPage },
];
