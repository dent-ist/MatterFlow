import { Routes } from '@angular/router';
import { ForbiddenPage } from './pages/forbidden-page';
import { NotFoundPage } from './pages/not-found-page';

/** Routes rendered inside the app shell. */
export const SYSTEM_ROUTES: Routes = [
  { path: '403', title: 'No Access', component: ForbiddenPage },
  { path: '404', title: 'Page Not Found', component: NotFoundPage },
  { path: '**', title: 'Page Not Found', component: NotFoundPage },
];
