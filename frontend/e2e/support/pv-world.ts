import { Json } from './api';
import { MmWorld, mmWorld } from './my-matters-fixtures';
import { Personas } from './personas';
import { Seeder, uid } from './seed';

/**
 * The world of the PM v2 page-fix specs of lane H (epic #851, #881 to #885): one Project Manager who manages two matters, one with a sensitive flag
 * and a demo-like name; assets with a size and one Pending disposition; two tasks on hold, one overdue task and one plain one. Everything goes
 * through the published API.
 */
export interface PvWorld {
  w: MmWorld;
  token: string;
  matterA: Json;
  matterB: Json;
  assets: Record<'big' | 'pending', Json>;
}

/**
 * The PM manages matter A (long demo-like name, a sensitive twin is not needed) and matter B. Matter A: a 10 GB asset (Active) and a 5.5 GB one
 * Pending disposition; two tasks on hold (one with a reason) and an Intake and a Production task, one overdue. Matter B: one task.
 */
export async function pvWorld(seed: Seeder, personas: Personas, label: string): Promise<PvWorld> {
  const admin = seed.admin;
  const w = await mmWorld(seed, personas, label);
  const token = uid().slice(0, 6);
  const type = await admin.post('/api/v1/asset-types', {
    name: `Workspace ${token}`,
    description: null,
  });
  const definition = await admin.get(
    `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${type.assetTypeId}`,
  );
  await seed.publishForm(definition.formDefinitionId, [
    { key: 'size_gb', label: 'Size (GB)', control: 'NUMBER' },
  ]);
  const current = await admin.get(`/api/v1/asset-types/${type.assetTypeId}`);
  await admin.put(`/api/v1/asset-types/${type.assetTypeId}/size-field`, {
    sizeFieldKey: 'size_gb',
    sizeUnit: 'GB',
    rowVersion: current.rowVersion,
  });
  const matterA = await w.matter('Demo Employment class action');
  const matterB = await w.matter('Demo Data breach response');
  // Demo-like names without the label the world appends, so the list shows them as a person would see them; matter A is sensitive (a lock after the name).
  const rename = async (matter: Json, name: string, isSensitive: boolean) => {
    const fresh = await admin.get(`/api/v1/matters/${matter.matterId}`);
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name,
      isSensitive,
      rowVersion: fresh.rowVersion,
    });
  };
  await rename(matterA, 'Demo Employment class action', true);
  await rename(matterB, 'Demo Data breach response', false);
  const big = await admin.post('/api/v1/assets', {
    matterId: matterA.matterId,
    assetTypeId: type.assetTypeId,
    displayName: `Big ${token}`,
    formValues: { size_gb: 10 },
  });
  const pending = await admin.post('/api/v1/assets', {
    matterId: matterA.matterId,
    assetTypeId: type.assetTypeId,
    displayName: `Pending ${token}`,
    formValues: { size_gb: 5.5 },
  });
  const pendingNow = await admin.get(`/api/v1/assets/${pending.assetId}`);
  await admin.put(`/api/v1/assets/${pending.assetId}/disposition`, {
    dispositionCode: 'PENDING_DISPOSITION',
    note: 'Matter wrapped up',
    rowVersion: pendingNow.rowVersion,
  });
  const hold = async (task: Json, comment: string) =>
    admin.post(`/api/v1/tasks/${task.taskId}/status`, {
      status: 'ON_HOLD',
      comment,
      rowVersion: task.rowVersion,
    });
  await hold(await w.task(matterA, { title: `Held one ${token}` }), 'Waiting for the client');
  await hold(await w.task(matterA, { title: `Held two ${token}` }), 'Waiting for the client');
  await w.task(matterA, { title: `Late ${token}`, dueDate: '2000-01-01' });
  await w.task(matterB, { title: `Plain ${token}` });
  return { w, token, matterA, matterB, assets: { big, pending } };
}
