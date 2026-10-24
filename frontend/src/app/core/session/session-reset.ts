import { Injectable } from '@angular/core';

/**
 * The one place that empties everything a screen cached about the signed-in person (sensitive-matter epic #788, README section 11 items 1 and 7).
 * A store that keeps names, messages or lists from the server registers a `clear` function when it is created (`register`), and `run` calls them
 * all when the person behind the session changes (`AuthStore` notices a different user id in the profile). Nothing registered here is ever written
 * to `localStorage`; the registry itself holds no data and imports no store, so the eager shell can inject it without pulling the API client in.
 */
@Injectable({ providedIn: 'root' })
export class SessionReset {
  private readonly handlers = new Set<() => void>();

  /** Adds a function that forgets the person's data. Returns a function that removes it again (stores that live for the whole session may ignore it). */
  register(clear: () => void): () => void {
    this.handlers.add(clear);
    return () => this.handlers.delete(clear);
  }

  /** Empties every registered cache. One failing handler never stops the others. */
  run(): void {
    for (const clear of [...this.handlers]) {
      try {
        clear();
      } catch {
        /* a cache that cannot be emptied is rebuilt on its next load */
      }
    }
  }
}
