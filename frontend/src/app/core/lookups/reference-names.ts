import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetResponse, AssetsClient, UsersLookupClient } from '../../api/generated/api-client';
import { AuthStore } from '../auth/auth.store';

/** How long a resolved asset is reused; short, so a rename shows up soon. */
const CACHE_MS = 30_000;

/** What a read-only ASSET_REF shows: the asset's name, its type and its external reference. */
export interface AssetSummary {
  assetId: number;
  displayName: string;
  assetTypeName: string;
  externalReference: string | undefined;
  isActive: boolean;
}

const toSummary = (a: AssetResponse): AssetSummary => ({
  assetId: a.assetId,
  displayName: a.displayName,
  assetTypeName: a.assetTypeName,
  externalReference: a.externalReference,
  isActive: a.isActive,
});

/**
 * Resolves the ids stored in ASSET_REF and USER_REF form values to names (UAT2-01), so read-only views show "Contract bundle" and
 * "Jamal Okafor" instead of `5`. Every id is fetched once per session and the requests of a page share the same promises, so a
 * form with several references costs one call per distinct asset and a single call for all users.
 */
@Injectable({ providedIn: 'root' })
export class ReferenceNames {
  private readonly assetsApi = inject(AssetsClient);
  private readonly injector = inject(Injector);
  private readonly assets = new Map<number, { at: number; found: Promise<AssetSummary | null> }>();
  private users: Promise<Map<number, string>> | null = null;

  asset(id: number): Promise<AssetSummary | null> {
    const cached = this.assets.get(id);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.found;
    const found = firstValueFrom(this.assetsApi.getAsset(id))
      .then(toSummary)
      .catch(() => {
        this.assets.delete(id);
        return null;
      });
    this.assets.set(id, { at: Date.now(), found });
    return found;
  }

  /** Display name of an active user; null when unknown (inactive, not found, or the caller may not look users up). */
  async user(id: number): Promise<string | null> {
    // The lookup needs Task.Assign; without it there is nothing to ask (and no 403 in the console).
    if (!this.injector.get(AuthStore).has('Task.Assign')) return null;
    this.users ??= firstValueFrom(this.injector.get(UsersLookupClient).lookupUsers(undefined, 50))
      .then((list) => new Map(list.map((u) => [u.userId, u.displayName] as const)))
      .catch(() => new Map<number, string>());
    return (await this.users).get(id) ?? null;
  }

  /** Forget everything cached (after an asset was renamed, for example). */
  reset(): void {
    this.assets.clear();
    this.users = null;
  }
}
