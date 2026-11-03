import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
// Types only: the generated client is one big module that the header (loaded on every page) must not pull in. The client itself is
// imported the first time it is needed (see `client()`).
import type {
  MyAvailabilityClient,
  SaveAvailabilityRequest,
  UserAvailabilityDto,
} from '../../api/generated/api-client';
import type { AbsenceType } from '../../shared/availability/absences/absence-contract';
import { AuthStore } from '../auth/auth.store';
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

  /** The Out of office API, loaded when first needed (the header is on every page; the fixtures and the client are not). */
  private async absences() {
    const { ABSENCE_API } = await import('../../shared/availability/absences/absence-api');
    return this.injector.get(ABSENCE_API);
  }

  private userId(): number {
    return this.injector.get(AuthStore).profile()?.userId ?? 0;
  }

  /**
   * "I'm back" (epic #1074, CAL-05): the current entry ends yesterday (an entry that starts today is removed). Throws the API error. The header reads the
   * profile again afterwards.
   */
  async setAvailable(): Promise<void> {
    const api = await this.absences();
    const current = (await api.list(this.userId(), false)).find((e) => e.state === 'NOW');
    if (current) await api.back(this.userId(), current.absenceId);
    await this.refresh();
  }

  /**
   * "Set out of office..." from the header menu: a new entry that starts today and ends on `until` (`yyyy-MM-dd`, or open-ended), with an optional note.
   * Throws the API error (an overlap names the other entry).
   */
  async setOutOfOffice(
    until: string | null,
    note: string,
    startDate: string,
    type: AbsenceType = 'VACATION',
  ): Promise<void> {
    const api = await this.absences();
    await api.create(this.userId(), {
      type,
      startDate,
      endDate: until,
      note: note.trim().slice(0, NOTE_MAX) || null,
    });
    await this.refresh();
  }
}
