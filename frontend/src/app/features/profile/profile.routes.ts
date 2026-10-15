import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { ProfilePage } from './profile-page';

/** My profile: the signed-in person's availability and work hours. */
export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    title: 'My profile',
    component: ProfilePage,
    canDeactivate: [unsavedChangesGuard],
  },
];
