import { Routes } from '@angular/router';
import { NotificationsPage } from './notifications-page';

/** The Notifications page (NT-D4, #748). Reached with Task.View, like the bell. */
export const NOTIFICATIONS_ROUTES: Routes = [
  { path: '', title: 'Notifications', component: NotificationsPage },
];
