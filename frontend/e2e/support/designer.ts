import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from './api';
import { axeAvailable, axeViolations } from './axe';
import { expect } from './fixtures';
import { Seeder, uid } from './seed';

/**
 * Helpers of the form designer specs (Task Types UX epic #352, WP-TY8). Screenshots go to the folder in E2E_SCREENSHOTS
 * (docs/ux/task-types-review/fixes/ty8-designer) when it is set.
 */
export const OUT = process.env['E2E_SCREENSHOTS'];

export const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

interface Field {
  key: string;
  label: string;
  control: string;
  required?: boolean;
  helpText?: string | null;
  options?: { key: string; label: string }[];
}

/** `count` text fields (every fifth a dropdown) with labels that are long on request. */
export function manyFields(count: number, long = false): Field[] {
  return Array.from({ length: count }, (_, i) => {
    const label = long
      ? `Request field ${i + 1} with a long descriptive label that goes on and on to test wrapping inside the narrow list`
      : `Field ${i + 1}`;
    return i % 5 === 4
      ? {
          key: `field_${i + 1}`,
          label,
          control: 'SELECT',
          options: [
            { key: 'a', label: 'Option A' },
            { key: 'b', label: 'Option B' },
          ],
        }
      : { key: `field_${i + 1}`, label, control: 'TEXT', required: i % 7 === 0 };
  });
}

export interface DesignerWorld {
  id: number;
  formId: number;
  name: string;
  url: string;
}

/**
 * A task type with a form. `published` publishes version 1 with the fields; `draft` then opens a draft (copied from it) or, with no
 * published version, saves the fields into a first draft.
 */
export async function typeWorld(
  seed: Seeder,
  admin: Api,
  opts: { fields?: Field[]; published?: boolean; draft?: boolean; name?: string } = {},
): Promise<DesignerWorld> {
  const wf = await seed.workflow({ stepCount: 1 });
  const name = opts.name ?? `E2E Designer ${uid()}`;
  const created = await admin.post('/api/v1/task-types', {
    name,
    description: null,
    isActive: true,
    eligibleWorkflowIds: [wf.workflowDefinitionId],
    defaultWorkflowDefinitionId: wf.workflowDefinitionId,
  });
  const formId = created.formDefinitionId as number;
  const fields = opts.fields ?? manyFields(6);
  if (opts.published) await seed.publishForm(formId, fields);
  if (opts.draft) {
    const draft = await admin.post(`/api/v1/forms/${formId}/versions`);
    if (!opts.published) {
      await admin.put(`/api/v1/forms/${formId}/versions/${draft.version.formVersionId}`, {
        fields,
        rowVersion: draft.version.rowVersion,
      });
    }
  }
  return { id: created.id, formId, name, url: `/admin/task-types/${created.id}/form` };
}

/** A step with a form of its own (the step's form is published or left as a draft). */
export async function stepWorld(
  seed: Seeder,
  admin: Api,
  opts: { fields?: Field[]; published?: boolean; draft?: boolean } = {},
): Promise<DesignerWorld> {
  const title = `E2E Designer Step ${uid()}`;
  const created = await admin.post('/api/v1/step-definitions', {
    title,
    description: null,
    instructions: null,
    tags: [],
  });
  const step = { id: created.stepDefinitionId as number, title };
  const formId = created.formDefinitionId as number;
  const fields = opts.fields ?? manyFields(6);
  if (opts.published) await seed.publishForm(formId, fields);
  if (opts.draft) {
    const draft = await admin.post(`/api/v1/forms/${formId}/versions`);
    if (!opts.published) {
      await admin.put(`/api/v1/forms/${formId}/versions/${draft.version.formVersionId}`, {
        fields,
        rowVersion: draft.version.rowVersion,
      });
    }
  }
  return { id: step.id, formId, name: step.title, url: `/admin/steps/${step.id}/form` };
}

/**
 * A form of an owner that has its own endpoint for it (asset types, and the singleton custom-field forms): makes sure it exists and,
 * with `fields`, leaves an open draft holding them (an existing draft is overwritten, so use a fresh asset type, not a shared form).
 */
export async function ensureForm(
  admin: Api,
  ownerKind: 'AssetType' | 'Client' | 'Matter' | 'Project',
  ownerId: number | undefined,
  opts: { fields?: Field[]; published?: boolean; draft?: boolean } = {},
): Promise<number> {
  const def = await admin.post('/api/v1/forms', { ownerKind, ownerId });
  const formId = def.formDefinitionId as number;
  const fields = opts.fields ?? manyFields(6);
  if (opts.published) await seedForm(admin, formId, fields, true);
  if (opts.draft) await seedForm(admin, formId, fields, false);
  return formId;
}

async function seedForm(admin: Api, formId: number, fields: Field[], publish: boolean) {
  const draft = await admin.post(`/api/v1/forms/${formId}/versions`);
  const saved = await admin.put(`/api/v1/forms/${formId}/versions/${draft.version.formVersionId}`, {
    fields,
    rowVersion: draft.version.rowVersion,
  });
  if (publish) {
    await admin.post(
      `/api/v1/forms/${formId}/versions/${saved.version.formVersionId}/publish?rowVersion=${encodeURIComponent(saved.version.rowVersion)}`,
    );
  }
}

/**
 * The singleton custom-field form of an object (`client`, `matter` or `project`). It is shared by every test, so nothing existing is
 * overwritten: when it has no open draft one is opened (with `fields`); a draft that is already there is left as it is.
 */
export async function customFieldWorld(
  admin: Api,
  key: 'client' | 'matter' | 'project',
  fields: Field[] = manyFields(30),
): Promise<DesignerWorld> {
  const kind = { client: 'Client', matter: 'Matter', project: 'Project' }[key] as
    'Client' | 'Matter' | 'Project';
  const def = await admin.post('/api/v1/forms', { ownerKind: kind });
  if (!def.draftVersionId) await seedForm(admin, def.formDefinitionId, fields, false);
  return {
    id: 0,
    formId: def.formDefinitionId,
    name: `${key} custom fields`,
    url: `/admin/custom-fields/${key}/form`,
  };
}

/** A new asset type; its designer is `/admin/asset-types/<id>/form`. */
export async function assetTypeWorld(
  admin: Api,
  opts: { fields?: Field[]; published?: boolean; draft?: boolean } = {},
): Promise<DesignerWorld> {
  const name = `E2E Asset Type ${uid()}`;
  const t = await admin.post('/api/v1/asset-types', { name, description: null });
  const formId = await ensureForm(admin, 'AssetType', t.assetTypeId, opts);
  return { id: t.assetTypeId, formId, name, url: `/admin/asset-types/${t.assetTypeId}/form` };
}

export async function noSideScroll(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

/** The page itself does not scroll (a fixed-height page): its scrolling element is as tall as the window. */
export async function noPageScroll(page: Page): Promise<void> {
  const extra = await page.evaluate(() => {
    const main = document.querySelector('.mf-main') as HTMLElement | null;
    const doc = document.documentElement;
    return Math.max(
      doc.scrollHeight - doc.clientHeight,
      main ? main.scrollHeight - main.clientHeight : 0,
    );
  });
  expect(extra).toBeLessThanOrEqual(1);
}

export async function shoot(
  page: Page,
  name: string,
  size: { w: number; h: number },
): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.w}x${size.h}.png`) });
}

export async function expectNoViolations(page: Page, label: string): Promise<void> {
  if (!axeAvailable()) return;
  const found = await axeViolations(page);
  expect(found, `${label}: ${JSON.stringify(found)}`).toEqual([]);
}
