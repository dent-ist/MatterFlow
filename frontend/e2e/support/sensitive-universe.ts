import { Page } from '@playwright/test';
import { Api, BASE_URL, Json } from './api';
import { Persona, Personas } from './personas';
import { Seeder, uid } from './seed';

/**
 * The "universe" of the sensitive-matter end-to-end specs (epic #788, README section 12.1 and 12.4): one client, four matters (a normal control
 * and three sensitive ones), their projects, tasks, comments and assets, and the six personas. Every piece of sensitive text carries a sentinel
 * (`ZZSENS-<tag>-S1 ...`), so a scan of a page, its storage and its network answers can prove that nothing leaked to a person who may not see it.
 *
 *   S1  sensitive, Primary manager P1, Secondary manager P2; project, two tasks, a comment, an asset
 *   S2  sensitive, no manager; project, task, comment, asset
 *   S3  sensitive, no manager; a task assigned to P3 (with a comment and a linked asset), a second task nobody has, a project, an asset not linked
 *   N1  normal control: everybody sees it (a scan that never finds it would prove nothing)
 *
 * Personas (the same grants as the backend universe, so a difference between them comes from the rule alone):
 *   P1 primary manager, P2 secondary manager, P3 task assignee, P4 holds Matter.ViewSensitive, P5 unrelated, P6 authenticated with Client.View only.
 *
 * Everything is created through the admin API (the administrator sees all). The rule must be on (`Features__SensitiveMatterAccess=true`, see
 * `run-local.sh`); `probeRule` tells, and the specs skip themselves when it is off.
 */

/** The permissions P1 to P5 hold: broad, but no Matter.ViewSensitive (P4 adds it). */
export const BROAD_PERMISSIONS = [
  'Task.View',
  'Task.Create',
  'Task.Edit',
  'Task.Assign',
  'Task.Comment',
  'Task.SetPriority',
  'Task.ChangeStatus',
  'Task.Complete',
  'Task.Cancel',
  'Task.Reopen',
  'Matter.View',
  'Matter.Create',
  'Matter.Edit',
  'Matter.EditNumber',
  'Matter.SetActive',
  'Matter.AssignManagers',
  'Matter.BeManager',
  'Project.View',
  'Project.Create',
  'Project.Edit',
  'Client.View',
  'Asset.View',
  'Asset.Link',
  'Asset.Create',
  'Asset.Edit',
  'Workflow.Execute',
  'Workflow.StepReopen',
  'Pod.View',
  'User.View',
  'Audit.View',
  'Dashboard.View',
  'Dashboard.ViewSummary',
  'Dashboard.ViewUnassigned',
  'Dashboard.ViewBreakdowns',
  'Dashboard.ViewTrends',
  'Dashboard.ViewSwimlane',
  'Dashboard.ViewUsers',
  'Dashboard.ViewCoverage',
] as const;

export type PersonaKey = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'admin';

/** One piece of text that must appear only for the people who may see it. */
export interface Sentinel {
  /** The exact text the scan looks for. */
  text: string;
  /** What it is, for the failure message. */
  what: string;
  /** Who may see it (the administrator may see everything and is not listed). */
  visibleTo: readonly PersonaKey[];
}

export interface MatterSet {
  matterId: number;
  matterRef: string;
  name: string;
  projectId: number;
  projectName: string;
  /** The first task (assigned to P3 on S3). */
  taskId: number;
  taskNumber: string;
  taskTitle: string;
  assetId: number;
  assetName: string;
}

export interface SensitiveUniverse {
  tag: string;
  client: Json;
  n1: MatterSet;
  s1: MatterSet;
  s2: MatterSet;
  /** S3 and its task assigned to P3; `otherTask` and `otherAsset` belong to the matter only. */
  s3: MatterSet & {
    otherTaskId: number;
    otherTaskNumber: string;
    otherTaskTitle: string;
    otherAssetId: number;
    otherAssetName: string;
    otherProjectId: number;
    otherProjectName: string;
  };
  people: Record<Exclude<PersonaKey, 'admin'>, Persona>;
  /** Every sentinel of the universe with who may see it. */
  sentinels: readonly Sentinel[];
  /** The rule is on (a person outside it gets 404 for S2). False: the specs skip. */
  ruleOn: boolean;
  /** Text the control matter N1 shows to everybody. */
  controlText: string;
}

/** All sensitive text for one matter set: the matter name, its ref, project name, task title and number, asset name. */
function sentinelsOf(set: MatterSet, visibleTo: readonly PersonaKey[], label: string): Sentinel[] {
  return [
    { text: set.name, what: `${label} matter name`, visibleTo },
    { text: set.matterRef, what: `${label} matter reference`, visibleTo },
    { text: set.projectName, what: `${label} project name`, visibleTo },
    { text: set.taskTitle, what: `${label} task title`, visibleTo },
    { text: set.assetName, what: `${label} asset name`, visibleTo },
  ];
}

export async function buildUniverse(
  seed: Seeder,
  personas: Personas,
  admin: Api,
): Promise<SensitiveUniverse> {
  const tag = uid()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8);
  const world = await seed.world();
  const client = await seed.client({ name: `Universe Client ${tag}` });

  const make = async (
    key: 'N1' | 'S1' | 'S2' | 'S3',
    number: string,
    sensitive: boolean,
    managers?: { primary: Persona; secondary: Persona },
  ): Promise<MatterSet> => {
    const name = `ZZSENS-${tag}-${key} matter`;
    const created: Json = await admin.post('/api/v1/matters', {
      clientId: client.clientId,
      matterNumber: number,
      name: sensitive ? name : `Control-${tag} matter`,
      isSensitive: sensitive,
    });
    if (managers) {
      await admin.put(`/api/v1/matters/${created.matterId}/managers`, {
        primaryManagerId: managers.primary.userId,
        secondaryManagerId: managers.secondary.userId,
        rowVersion: created.rowVersion,
      });
    }
    const projectName = sensitive ? `ZZSENS-${tag}-${key} project` : `Control-${tag} project`;
    const project: Json = await admin.post('/api/v1/projects', {
      matterId: created.matterId,
      name: projectName,
    });
    const assetName = sensitive ? `ZZSENS-${tag}-${key} asset` : `Control-${tag} asset`;
    const asset: Json = await admin.post('/api/v1/assets', {
      matterId: created.matterId,
      assetTypeId: await seed.assetTypeId(),
      displayName: assetName,
    });
    return {
      matterId: created.matterId,
      matterRef: created.matterRef,
      name: sensitive ? name : `Control-${tag} matter`,
      projectId: project.projectId,
      projectName,
      taskId: 0,
      taskNumber: '',
      taskTitle: '',
      assetId: asset.assetId,
      assetName,
    };
  };

  const people = {
    p1: await personas.create({
      label: 'sm-p1',
      displayName: 'Pat Primary',
      permissions: [...BROAD_PERMISSIONS],
    }),
    p2: await personas.create({
      label: 'sm-p2',
      displayName: 'Sam Secondary',
      permissions: [...BROAD_PERMISSIONS],
    }),
    p3: await personas.create({
      label: 'sm-p3',
      displayName: 'Alex Assignee',
      permissions: [...BROAD_PERMISSIONS],
    }),
    p4: await personas.create({
      label: 'sm-p4',
      displayName: 'Vic Viewer',
      permissions: [...BROAD_PERMISSIONS, 'Matter.ViewSensitive'],
    }),
    p5: await personas.create({
      label: 'sm-p5',
      displayName: 'Uma Unrelated',
      permissions: [...BROAD_PERMISSIONS],
    }),
    p6: await personas.create({
      label: 'sm-p6',
      displayName: 'Nora NoMatter',
      permissions: ['Client.View'],
    }),
  };

  const n1 = await make('N1', '00020', false);
  const s1 = await make('S1', '00021', true, { primary: people.p1, secondary: people.p2 });
  const s2 = await make('S2', '00022', true);
  const s3base = await make('S3', '00023', true);

  const taskOn = async (
    set: MatterSet,
    title: string,
    assignedUserId?: number,
  ): Promise<{ taskId: number; taskNumber: string; title: string }> => {
    const task: Json = await seed.task(
      { matter: { matterId: set.matterId }, taskType: world.taskType, workflow: world.workflow },
      {
        title,
        projectId: set.projectId,
        description: `<p>${title} description</p>`,
        assignedUserId,
      },
    );
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml: `<p>${title} comment</p>`,
    });
    return { taskId: task.taskId, taskNumber: task.taskNumber, title };
  };

  const fill = async (set: MatterSet, key: string, sensitive: boolean, assignee?: Persona) => {
    const title = sensitive ? `ZZSENS-${tag}-${key} task` : `Control-${tag} task`;
    const t = await taskOn(set, title, assignee?.userId);
    set.taskId = t.taskId;
    set.taskNumber = t.taskNumber;
    set.taskTitle = title;
  };
  await fill(n1, 'N1', false, people.p5);
  await fill(s1, 'S1', true);
  await fill(s2, 'S2', true);
  await fill(s3base, 'S3', true, people.p3);

  // S3: the asset named after the matter is NOT linked; a second asset is linked to the assignee's task (the assignee may read that one, mode A).
  const otherAssetName = `ZZSENS-${tag}-S3 linked asset`;
  const otherAsset: Json = await admin.post('/api/v1/assets', {
    matterId: s3base.matterId,
    assetTypeId: await seed.assetTypeId(),
    displayName: otherAssetName,
  });
  await admin.post(`/api/v1/tasks/${s3base.taskId}/assets`, { assetId: otherAsset.assetId });
  // S3: a second task nobody holds (matter level only), in its own project: the project of the assignee's task is task data and shows with that task,
  // the project of the other task belongs to the matter and stays hidden from her.
  const otherProjectName = `ZZSENS-${tag}-S3 other project`;
  const otherProject: Json = await admin.post('/api/v1/projects', {
    matterId: s3base.matterId,
    name: otherProjectName,
  });
  const otherTitle = `ZZSENS-${tag}-S3 other task`;
  const other = await taskOn({ ...s3base, projectId: otherProject.projectId }, otherTitle);
  // S1: an asset linked to its task does not change who sees S1.

  const s3 = {
    ...s3base,
    otherTaskId: other.taskId,
    otherTaskNumber: other.taskNumber,
    otherTaskTitle: otherTitle,
    otherAssetId: otherAsset.assetId,
    otherAssetName,
    otherProjectId: otherProject.projectId,
    otherProjectName,
  };

  const matterLevel: readonly PersonaKey[] = ['p4'];
  const sentinels: Sentinel[] = [
    ...sentinelsOf(s1, ['p1', 'p2', 'p4'], 'S1'),
    {
      text: `ZZSENS-${tag}-S1 task comment`,
      what: 'S1 task comment',
      visibleTo: ['p1', 'p2', 'p4'],
    },
    ...sentinelsOf(s2, ['p4'], 'S2'),
    { text: `ZZSENS-${tag}-S2 task comment`, what: 'S2 task comment', visibleTo: ['p4'] },
    // S3: the assignee (P3) sees the matter header (name, reference) and its own task with its linked asset, nothing else of the matter.
    { text: s3.name, what: 'S3 matter name (header)', visibleTo: ['p3', 'p4'] },
    { text: s3.matterRef, what: 'S3 matter reference (header)', visibleTo: ['p3', 'p4'] },
    { text: s3.taskTitle, what: 'S3 task title (assigned to P3)', visibleTo: ['p3', 'p4'] },
    { text: s3.otherAssetName, what: 'S3 asset linked to the task of P3', visibleTo: ['p3', 'p4'] },
    // The project of the assignee's own task is task data (README section 1): it shows with that task. The matter's other project does not.
    {
      text: s3.projectName,
      what: 'S3 project of the task of P3 (task data)',
      visibleTo: ['p3', 'p4'],
    },
    { text: s3.otherProjectName, what: 'S3 other project name', visibleTo: matterLevel },
    { text: s3.assetName, what: 'S3 asset not linked to the task of P3', visibleTo: matterLevel },
    { text: s3.otherTaskTitle, what: 'S3 other task title', visibleTo: matterLevel },
    {
      text: `ZZSENS-${tag}-S3 other task comment`,
      what: 'S3 other task comment',
      visibleTo: matterLevel,
    },
  ];

  const probe = await Api.as(people.p5.username);
  const status = (await probe.raw('GET', `/api/v1/matters/${s2.matterId}`)).status;
  await probe.dispose();

  return {
    tag,
    client,
    n1,
    s1,
    s2,
    s3,
    people,
    sentinels,
    ruleOn: status === 404,
    controlText: `Control-${tag}`,
  };
}

/** The text every sentinel of this universe a person must NOT see. */
export function hiddenFor(u: SensitiveUniverse, who: PersonaKey): Sentinel[] {
  return who === 'admin' ? [] : u.sentinels.filter((s) => !s.visibleTo.includes(who));
}

/** The sentinels a person may see (positive controls: a walk that never finds them proves nothing). */
export function visibleFor(u: SensitiveUniverse, who: PersonaKey): Sentinel[] {
  return who === 'admin' ? [...u.sentinels] : u.sentinels.filter((s) => s.visibleTo.includes(who));
}

// ---- the scan ---------------------------------------------------------------------------------------------------------------------

interface Captured {
  url: string;
  status: number;
  body: string;
}

/** Records the body of every API answer the page receives, so the scan can include the network. */
export class NetworkRecorder {
  readonly answers: Captured[] = [];
  private pending: Promise<unknown>[] = [];

  attach(page: Page): void {
    page.on('response', (response) => {
      const url = response.url();
      if (!url.startsWith(BASE_URL) || !url.includes('/api/')) return;
      this.pending.push(
        response
          .text()
          .then((body) => this.answers.push({ url, status: response.status(), body }))
          .catch(() => undefined),
      );
    });
  }

  async settled(): Promise<Captured[]> {
    await Promise.all(this.pending);
    this.pending = [];
    return this.answers;
  }
}

export interface Finding {
  where: string;
  what: string;
}

/** Everything the browser shows or keeps right now: visible text, title, storage and IndexedDB, as named strings. */
export async function pageSurface(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const out: Record<string, string> = {};
    out['dom'] = document.body.innerText;
    out['html-attributes'] = Array.from(
      document.querySelectorAll('[title],[aria-label],[href],[alt],[placeholder],[data-title]'),
    )
      .map((e) =>
        ['title', 'aria-label', 'href', 'alt', 'placeholder', 'data-title']
          .map((a) => e.getAttribute(a) ?? '')
          .join(' '),
      )
      .join('\n');
    out['title'] = document.title;
    out['localStorage'] = JSON.stringify(Object.entries(localStorage));
    out['sessionStorage'] = JSON.stringify(Object.entries(sessionStorage));
    try {
      const dbs = (await indexedDB.databases?.()) ?? [];
      const dump: string[] = [];
      for (const info of dbs) {
        dump.push(`db:${info.name}`);
        if (!info.name) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(info.name!);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<unknown[]>((resolve, reject) => {
            const req = db.transaction(store).objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          dump.push(`${store}:${JSON.stringify(rows)}`);
        }
        db.close();
      }
      out['indexedDB'] = dump.join('\n');
    } catch {
      out['indexedDB'] = '';
    }
    try {
      out['cacheStorage'] = (await caches.keys()).join(',');
    } catch {
      out['cacheStorage'] = '';
    }
    return out;
  });
}

/** Looks for the forbidden texts in the page surface and in every network answer so far; the findings say where each one was found. */
export async function scan(
  page: Page,
  recorder: NetworkRecorder,
  forbidden: readonly Sentinel[],
  step: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const surface = await pageSurface(page);
  for (const s of forbidden) {
    for (const [where, text] of Object.entries(surface)) {
      if (text.includes(s.text)) findings.push({ where: `${step}: ${where}`, what: s.what });
    }
  }
  for (const answer of await recorder.settled()) {
    for (const s of forbidden) {
      if (answer.body.includes(s.text)) {
        findings.push({
          where: `${step}: network ${answer.status} ${answer.url.replace(BASE_URL, '')}`,
          what: s.what,
        });
      }
    }
  }
  return findings;
}
