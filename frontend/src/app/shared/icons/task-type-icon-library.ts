import { Injectable, signal } from '@angular/core';

/**
 * The Task Type icon library, loaded lazily. The icon data is generated (tools/icons) and lives in two separate chunks so it stays out
 * of the initial bundle: the SVG markup (needed wherever an icon is shown) and the searchable catalog (needed only by the picker).
 * Both are our own bundled data (Tabler Icons, MIT): nothing is fetched from a CDN.
 */
@Injectable({ providedIn: 'root' })
export class TaskTypeIconLibrary {
  private readonly loadedPaths = signal<Readonly<Record<string, string>> | null>(null);
  private pathsLoading: Promise<void> | null = null;
  private catalogLoading: Promise<typeof import('./task-type-icon-catalog.generated')> | null =
    null;

  /** Key to inner SVG markup; null until the chunk has loaded. */
  readonly paths = this.loadedPaths.asReadonly();

  /** Starts loading the SVG markup once; resolves when it is available. */
  ensurePaths(): Promise<void> {
    this.pathsLoading ??= import('./task-type-icon-paths.generated')
      .then((m) => this.loadedPaths.set(m.TASK_TYPE_ICON_PATHS))
      .catch(() => {
        this.pathsLoading = null; // allow a retry on the next use
      });
    return this.pathsLoading;
  }

  /** The searchable catalog (key, label, category, keywords); loaded on first use. */
  catalog(): Promise<typeof import('./task-type-icon-catalog.generated')> {
    this.catalogLoading ??= import('./task-type-icon-catalog.generated').catch((e: unknown) => {
      this.catalogLoading = null;
      throw e;
    });
    return this.catalogLoading;
  }
}
