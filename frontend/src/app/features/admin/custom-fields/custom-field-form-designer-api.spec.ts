import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AssetTypesClient, FormsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { recordFailureOf } from '../../../shared/ui/record-state';
import { AssetTypeFormDesignerApi } from '../asset-types/asset-type-form-designer-api';
import { CustomFieldFormDesignerApi } from './custom-field-form-designer-api';

describe('unknown addresses of the form designers (#541)', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        CustomFieldFormDesignerApi,
        AssetTypeFormDesignerApi,
        { provide: FormsClient, useValue: { ensureFormDefinition: vi.fn() } },
        { provide: AssetTypesClient, useValue: { getAssetType: vi.fn() } },
      ],
    }),
  );

  it('an object that is not Client, Matter or Project is a 404, not a plain error', async () => {
    const api = TestBed.inject(CustomFieldFormDesignerApi);
    const owner = await firstValueFrom(api.getOwner('matter'));
    expect(owner.name).toBe('Matter custom fields');

    const error = await firstValueFrom(api.getOwner('nothing')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(recordFailureOf(error)).toBe('notFound');
    const versions = await firstValueFrom(api.listVersions('nothing')).catch((e: unknown) => e);
    expect(recordFailureOf(versions)).toBe('notFound');
    expect(TestBed.inject(FormsClient).ensureFormDefinition).not.toHaveBeenCalled();
  });

  it('an asset type address that is not a number is a 404 without a request', async () => {
    const api = TestBed.inject(AssetTypeFormDesignerApi);
    const error = await firstValueFrom(api.getOwner('abc')).catch((e: unknown) => e);
    expect(recordFailureOf(error)).toBe('notFound');
    expect(TestBed.inject(AssetTypesClient).getAssetType).not.toHaveBeenCalled();
  });
});
