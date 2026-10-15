import { Api, Json } from './api';
import { Seeder, World, uid } from './seed';
import { TaskApi } from './tasks';

/** An email pasted into a task description: long prose plus a wide table (plain text, as the description is stored today). */
export const EMAIL_DESCRIPTION = [
  'Hi team,',
  '',
  'Please process the attached collection for the Harbor Point matter. The custodians below were collected between March and June; the',
  'vendor delivered them in three batches and each batch has its own load file, so please keep the batch numbers in the workspace names.',
  '',
  'Custodian | Source | Batch | Volume (GB) | Date range | Notes',
  'Anna Weller | Exchange mailbox | B-001 | 14.2 | 2023-03-01 to 2023-06-30 | Includes archive and recoverable items; check the journaling rules before loading',
  'Marcus Okafor | Laptop image | B-001 | 220.8 | 2022-01-01 to 2023-06-30 | Full disk image, only user profile folders are in scope; skip the system and program files',
  'Priya Raman | Teams export | B-002 | 3.9 | 2023-02-15 to 2023-06-30 | Channel messages and one-to-one chats; attachments are separate files in the _files folder',
  'Jonas Lindqvist | Shared drive | B-002 | 96.4 | 2021-07-01 to 2023-06-30 | Deal room folders 04 through 11 only; folders 01 to 03 were produced earlier',
  'Elena Petrova | Mobile device | B-003 | 41.0 | 2023-04-01 to 2023-06-30 | iOS backup, texts and iMessage only; no photos',
  '',
  'Deadlines: the first load must be finished by Friday 5 pm Eastern so that review can start on Monday. If anything fails QC, tell me',
  'before you re-run it. Do not delete the original load files; legal wants them kept until the production is complete.',
  '',
  'Thanks,',
  'Rita',
].join('\n');

export interface BusyTask {
  taskId: number;
  taskNumber: string;
  title: string;
}

/**
 * A task as a technician sees it on a busy day: a long pasted email in the description, six steps (two done, the third current), twelve
 * comments (some long) and eight linked assets. Used by the screenshot run for docs/ux/task-detail-v2.
 */
export async function seedBusyTask(seed: Seeder, admin: Api): Promise<BusyTask> {
  const world: World = await seed.world({
    steps: [
      { title: 'Intake and conflict check' },
      { title: 'Collect custodian data' },
      { title: 'Process and de-duplicate' },
      { title: 'Load to Relativity workspace' },
      { title: 'Quality control pass' },
      { title: 'Deliver to review team' },
    ],
  });
  const task: Json = await seed.task(world, {
    title: `Process Harbor Point collection ${uid()}`,
    description: EMAIL_DESCRIPTION,
    requestorName: 'Rita Requestor',
  });
  const api = new TaskApi(admin, task.taskId);
  await api.start();
  await api.completeSteps(1, 2);
  const notes = [
    'Kicked off. Vendor confirmed three batches.',
    'Batch B-001 received, hash values match the manifest.',
    '<p>Question for Rita: should the <strong>Teams</strong> attachments be loaded as children?</p>',
    'Rita says yes, load them as family members of the message.',
    'Processing B-001 now, about 40 minutes.',
    '<p>B-001 done: <em>14,203</em> documents, 311 exceptions (password protected). Listing below.</p><ul><li>Password protected: 298</li><li>Corrupt: 13</li></ul>',
    'Batch B-002 received. Please note the shared drive folders 04 to 11 only.',
    'De-duplication across custodians finished; global dedupe on.',
    'Heads up: the iOS backup needs the vendor to re-send, the first file is truncated.',
    'Vendor re-sent B-003, checking hashes.',
    'All three batches processed. Ready for the Relativity load once QC signs off on the exception list.',
    '<p>Latest: load template agreed with the review lead; running the first load tonight.</p>',
  ];
  for (const body of notes) {
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml: body.startsWith('<') ? body : `<p>${body}</p>`,
    });
  }
  const roles = ['Source', 'Destination', 'Subject', 'Result'];
  const roleList = await admin.get<Json>('/api/v1/asset-link-roles');
  const roleIds: (number | null)[] = (roleList.items ?? roleList)
    .filter((r: Json) => roles.includes(r.name))
    .map((r: Json) => r.id ?? r.assetLinkRoleId);
  const names = [
    'Harbor Point mailbox export',
    'Okafor laptop image',
    'Teams export B-002',
    'Deal room shared drive',
    'Petrova iOS backup',
    'Relativity workspace HP-001',
    'Load file B-001',
    'QC exception list',
  ];
  for (const [i, name] of names.entries()) {
    const asset = await seed.asset(world.matter, `${name} ${uid()}`);
    await admin.post(`/api/v1/tasks/${task.taskId}/assets`, {
      assetId: asset.assetId,
      assetLinkRoleId: roleIds.length > 0 ? roleIds[i % roleIds.length] : undefined,
    });
  }
  const full = await api.get();
  return { taskId: task.taskId, taskNumber: full.taskNumber, title: full.title };
}
