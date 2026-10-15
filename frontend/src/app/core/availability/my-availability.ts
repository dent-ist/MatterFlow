import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
// Types only: the generated client is one big module that the header (loaded on every page) must not pull in. The client itself is
// imported the first time it is needed (see `client()`).
import type {
  MyAvailabilityClient,
  SaveAvailabilityRequest,
  UserAvailabilityDto,
} from '../../api/generated/api-client';
import { AvailabilityLike, NOTE_MAX } from './availability';

/** A save request that repeats a profile unchanged (the PUT replaces the whole profile), for quick actions that change only the status. */
export function requestFrom(
  dto: UserAvailabilityDto,
  change: Partial<SaveAvailabilityRequest>,
): SaveAvailabilityRequest {
  return {
    status: dto.status,
    from: dto.from,
    until: dto.until,
    note: dto.note,
    timeZoneId: dto.timeZoneId,
    workHours: dto.usesDefaultWorkHours ? undefined : dto.workHours,
    rowVersion: dto.rowVersion,
    ...change,
  };
}

/**
 * The signed-in person's own availability, for the header (the "out of office" label and the quick actions). The profile screen
 * calls `set` after every save so the header follows at once. The state is loaded once per session and again after a quick action.
 */
@Injectable({ providedIn: 'root' })
export class MyAvailability {
  private readonly injector = inject(Injector);
  private api: MyAvailabilityClient | undefined;
  private loaded = false;

  readonly profile = signal<UserAvailabilityDto | null>(null);
  /** How the person shows up right now, in the compact form every list uses. */
  readonly current = computed<AvailabilityLike | null>(() => {
    const c = this.profile()?.current;
    return c ? { state: c.state, outUntil: c.outUntilUtc, note: c.note } : null;
  });
  readonly isOut = computed(() => this.current()?.state === 'OUT_OF_OFFICE');

  private async client(): Promise<MyAvailabilityClient> {
    if (!this.api) {
      const { MyAvailabilityClient: client } = await import('../../api/generated/api-client');
      this.api = this.injector.get(client);
    }
    return this.api;
  }

  /** Loads the profile the first time; never rejects (the header simply shows nothing when it cannot be read). */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.profile.set(await firstValueFrom((await this.client()).getMyAvailability()));
      this.loaded = true;
    } catch {
      /* the header label is optional */
    }
  }

  set(profile: UserAvailabilityDto): void {
    this.loaded = true;
    this.profile.set(profile);
  }

  /** "I'm back": Available again, keeping the work hours and the time zone. Throws the API error. */
  async setAvailable(): Promise<UserAvailabilityDto> {
    const latest = await firstValueFrom((await this.client()).getMyAvailability());
    const saved = await firstValueFrom(
      (await this.client()).saveMyAvailability(
        requestFrom(latest, {
          status: 'AVAILABLE',
          from: undefined,
          until: undefined,
          note: undefined,
        }),
      ),
    );
    this.set(saved);
    return saved;
  }

  /** "Set out of office...": out of office from now until the end of `until` (`yyyy-MM-dd`, or open-ended), with an optional note. */
  async setOutOfOffice(until: string | null, note: string): Promise<UserAvailabilityDto> {
    const latest = await firstValueFrom((await this.client()).getMyAvailability());
    const saved = await firstValueFrom(
      (await this.client()).saveMyAvailability(
        requestFrom(latest, {
          status: 'OUT_OF_OFFICE',
          from: undefined,
          until: until ?? undefined,
          note: note.trim().slice(0, NOTE_MAX) || undefined,
        }),
      ),
    );
    this.set(saved);
    return saved;
  }
}
