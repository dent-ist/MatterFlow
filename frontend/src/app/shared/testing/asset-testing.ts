import {
  AssetListItem,
  AssetLookupItem,
  AssetResponse,
  AssetTypeResponse,
  FormFieldModel,
  FormOwnerKind,
  FormVersionDetail,
  FormVersionStatus,
  PagedResultOfAssetListItem,
  PagedResultOfAssetTypeResponse,
} from '../../api/generated/api-client';

/** Builders shared by the Asset component tests. */
export function anAssetType(overrides: Partial<AssetTypeResponse> = {}): AssetTypeResponse {
  return {
    assetTypeId: 4,
    name: 'Document Set',
    description: 'Sets of documents',
    sortOrder: 10,
    isActive: true,
    assetCount: 3,
    publishedFormVersionId: 21,
    publishedFormVersionNo: 2,
    rowVersion: 'TTTT',
    createdAtUtc: '2026-10-01T12:00:00Z',
    modifiedAtUtc: undefined,
    ...overrides,
  };
}

export function anAssetListItem(overrides: Partial<AssetListItem> = {}): AssetListItem {
  return {
    assetId: 9,
    matterId: 7,
    matterRef: '00343-00012',
    matterName: 'Merger Review',
    assetTypeId: 4,
    assetTypeName: 'Document Set',
    displayName: 'Contract bundle',
    externalReference: 'https://dms.example/folders/42',
    description: undefined,
    isActive: true,
    rowVersion: 'AAAA',
    createdAtUtc: '2026-10-01T12:00:00Z',
    modifiedAtUtc: undefined,
    ...overrides,
  };
}

export function anAsset(overrides: Partial<AssetResponse> = {}): AssetResponse {
  return {
    assetId: 9,
    matterId: 7,
    matterRef: '00343-00012',
    matterName: 'Merger Review',
    assetTypeId: 4,
    assetTypeName: 'Document Set',
    assetTypeIsActive: true,
    displayName: 'Contract bundle',
    externalReference: 'https://dms.example/folders/42',
    description: 'First batch',
    isActive: true,
    formVersionId: 21,
    publishedFormVersionId: 21,
    formValues: { workspace_id: 'WS-8841', notes: 'check later' },
    droppedFields: [],
    rowVersion: 'AAAA',
    createdAtUtc: '2026-10-01T12:00:00Z',
    modifiedAtUtc: undefined,
    ...overrides,
  };
}

export const aLookupItem = (overrides: Partial<AssetLookupItem> = {}): AssetLookupItem => ({
  assetId: 9,
  matterId: 7,
  assetTypeName: 'Document Set',
  displayName: 'Contract bundle',
  externalReference: undefined,
  isActive: true,
  ...overrides,
});

export const pageOfAssets = (...items: AssetListItem[]): PagedResultOfAssetListItem => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});

export const pageOfAssetTypes = (
  ...items: AssetTypeResponse[]
): PagedResultOfAssetTypeResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});

/** The published form of a Document Set: a required Workspace id, a Scanned checkbox and a conditional OCR language. */
export const DOCUMENT_FIELDS: FormFieldModel[] = [
  { key: 'workspace_id', label: 'Workspace ID', control: 'TEXT', required: true },
  { key: 'scanned', label: 'Scanned', control: 'CHECKBOX' },
  {
    key: 'ocr_language',
    label: 'OCR language',
    control: 'TEXT',
    showWhen: { op: 'isTrue', field: 'scanned' },
  },
  { key: 'notes', label: 'Notes', control: 'TEXTAREA' },
];

export function aFormVersion(
  fields: FormFieldModel[] = DOCUMENT_FIELDS,
  versionId = 21,
): FormVersionDetail {
  return {
    version: {
      formVersionId: versionId,
      formDefinitionId: 5,
      versionNo: 2,
      status: FormVersionStatus.Published,
      clonedFromVersionId: undefined,
      createdAtUtc: '2026-10-01T12:00:00Z',
      publishedAtUtc: '2026-10-01T12:00:00Z',
      publishedByUserId: undefined,
      notes: undefined,
      fieldCount: fields.length,
      rowVersion: 'FFFF',
    },
    ownerKind: FormOwnerKind.AssetType,
    ownerId: 4,
    fields,
  };
}
