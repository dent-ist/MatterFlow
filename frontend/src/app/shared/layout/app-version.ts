// The one source of truth for the version is the root package.json ("version"); the bundler keeps only this one property of it.
import { version } from '../../../../../package.json';

/** The app version shown at the foot of the navigation panel (MM-44, #940), for example `0.1.1`. */
export const APP_VERSION: string = version;

/** The visible text of the version line: "v0.1.1". */
export const versionLabel = (v: string = APP_VERSION): string => `v${v}`;

/** What a screen reader says (and the rail's name tip shows): "Version 0.1.1". */
export const versionName = (v: string = APP_VERSION): string => `Version ${v}`;
