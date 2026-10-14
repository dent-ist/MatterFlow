import { Routes } from '@angular/router';
import { PlaceholderPage } from './placeholder-page';

/** Single-screen placeholder route set for features that later tickets implement. */
export function placeholderRoutes(title: string): Routes {
  return [{ path: '', component: PlaceholderPage, data: { title } }];
}
