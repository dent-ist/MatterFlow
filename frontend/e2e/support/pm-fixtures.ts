import { Json } from './api';
import { Persona, Personas } from './personas';
import { Seeder, World, uid } from './seed';

/**
 * Project Manager fixtures (epic #667, #668): every case of the Project Manager review, created through the published API (managers through
 * `PUT /matters/{id}/managers`, so the audit trail is real) and tagged with a per-worker token so parallel workers never collide.
 *
 * ```ts
 * const fx = await pmFixtures(seed, personas);
 * const page = await asUser(fx.pmA.username);
 * await page.goto('/matters?mine=true');                 // the six matters of PM Alpha
 * ```
 *
 * People (the table in docs/ux/pm-review/fixtures.md lists the same):
 * - `pmA`: Project Manager role, manages seven matters (primary, secondary and both); `pmB`: Project Manager role, secondary on one of them and
 *   primary of `solo`; `pmNone`: Project Manager role, manages nothing; `pmNoTask`: the Project Manager's matter permissions without Task.View.
 * - `director`: the Director role (holds Matter.AssignManagers, cannot be named); `observer`: Read-Only Observer; `editor`: Matter.Edit
 *   without Matter.AssignManagers; `away`: a Data Technician who is out of office.
 * Matters (one client, numbers 00002 to 00012; names carry the token):
 * - `m.primary`, `m.secondary` (Secondary only for pmA, pmB is Primary), `m.both`, `m.overdue` (an overdue task), `m.unassigned` (two unassigned
 *   tasks), `m.hold` (a task on hold for ten days; needs the SQL container of run-local.sh), `m.solo` (pmB primary, no Secondary),
 *   `m.secondaryOnly` (Secondary without Primary), `m.none1`, `m.none2` and `m.none3` (no manager: normal; the bulk test changes the first two), `m.clean` (pmA, no tasks).
 *
 * Scope fixtures (epic #758, "My matters / All"): `pmNoAssign` (BeManager without Matter.AssignManagers; manages `m.noAssign`), `technician`
 * (Data Technician: no manager permission), a second client `otherClient` whose only matter `m.otherClient` has no manager (so the Clients list
 * has a client nobody manages), an asset and a project on a matter `pmA` manages (`assetMine`, `projectMine`) and on one nobody she manages
 * (`assetOther`, `projectOther`; `m.solo` belongs to pmB). The names carry the token.
 *
 * Idempotent per worker. The performance set (200 matters, 20,000 open tasks) belongs to #686 and is not built here.
 */
export interface PmMatter {
  matterId: number;
  matterRef: string;
  name: string;
}

export interface PmClient {
  clientId: number;
  clientNumber: string;
  name: string;
}

export interface PmRecord {
  id: number;
  name: string;
}

export interface PmFixtures {
  token: string;
  world: World;
  pmA: Persona;
  pmB: Persona;
  pmNone: Persona;
  pmNoTask: Persona;
  director: Persona;
  observer: Persona;
  editor: Persona;
  away: Persona;
  pmNoAssign: Persona;
  technician: Persona;
  otherClient: PmClient;
  assetMine: PmRecord;
  assetOther: PmRecord;
  projectMine: PmRecord;
  projectOther: PmRecord;
  m: Record<
    | 'primary'
    | 'secondary'
    | 'both'
    | 'overdue'
    | 'unassigned'
    | 'hold'
    | 'solo'
    | 'secondaryOnly'
    | 'none1'
    | 'none2'
    | 'none3'
    | 'clean'
    | 'noAssign'
    | 'otherClient',
    PmMatter
  >;
}

const cache = new WeakMap<Seeder, Promise<PmFixtures>>();

export function pmFixtures(seed: Seeder, personas: Personas): Promise<PmFixtures> {
  let built = cache.get(seed);
  if (!built) {
    built = build(seed, personas);
    cache.set(seed, built);
  }
  return built;
}

async function build(seed: Seeder, personas: Personas): Promise<PmFixtures> {
  const token = uid().slice(0, 5).toUpperCase();
  const world = await seed.world();
  const pm = (label: string, displayName: string) =>
    personas.create({ label, roles: ['Project Manager'], displayName: `${displayName} ${token}` });
  const pmA = await pm('pm-a', 'PM Alpha');
  const pmB = await pm('pm-b', 'PM Bravo');
  const pmNone = await pm('pm-none', 'PM Nobody');
  const pmNoTask = await personas.create({
    label: 'pm-notask',
    displayName: `PM NoTask ${token}`,
    permissions: [
      'Client.View',
      'Matter.View',
      'Matter.BeManager',
      'Matter.AssignManagers',
      'Project.View',
    ],
  });
  const director = await personas.create({ label: 'pm-director', roles: ['Director'] });
  const observer = await personas.create({ label: 'pm-observer', roles: ['Read-Only Observer'] });
  const editor = await personas.create({
    label: 'pm-editor',
    permissions: ['Client.View', 'Matter.View', 'Matter.Create', 'Matter.Edit', 'Task.View'],
  });
  const away = await personas.create({ label: 'pm-away', roles: ['Data Technician'] });
  const pmNoAssign = await personas.create({
    label: 'pm-noassign',
    displayName: `PM NoAssign ${token}`,
    permissions: [
      'Client.View',
      'Matter.View',
      'Matter.BeManager',
      'Project.View',
      'Task.View',
      'Asset.View',
    ],
  });
  const technician = await personas.create({ label: 'pm-tech', roles: ['Data Technician'] });
  await seed.outOfOffice(away.userId, { note: 'Annual leave' });

  const client = world.client;
  let next = 2; // the world already holds 00001
  const matter = async (name: string, primary: Persona | null, secondary: Persona | null) => {
    const created = await seed.matter({
      client,
      number: String(next++).padStart(5, '0'),
      name: `${name} ${token}`,
    });
    if (primary || secondary) {
      await seed.admin.put(`/api/v1/matters/${created.matterId}/managers`, {
        primaryManagerId: primary?.userId ?? null,
        secondaryManagerId: secondary?.userId ?? null,
        rowVersion: created.rowVersion,
      });
    }
    return {
      matterId: created.matterId,
      matterRef: created.matterRef,
      name: created.name,
    } as PmMatter;
  };
  const tasks = (matterRef: PmMatter, count: number, overrides: Json = {}) =>
    Promise.all(
      Array.from({ length: count }, () =>
        seed.task(
          {
            matter: { matterId: matterRef.matterId },
            taskType: world.taskType,
            workflow: world.workflow,
          },
          overrides,
        ),
      ),
    );

  const m = {
    primary: await matter('Alpha primary', pmA, null),
    secondary: await matter('Alpha secondary', pmB, pmA),
    both: await matter('Alpha both', pmA, pmB),
    overdue: await matter('Alpha overdue', pmA, null),
    unassigned: await matter('Alpha unassigned', pmA, null),
    hold: await matter('Alpha hold', pmA, null),
    solo: await matter('Bravo solo', pmB, null),
    secondaryOnly: await matter('Bravo secondary only', null, pmB),
    none1: await matter('No manager one', null, null),
    none2: await matter('No manager two', null, null),
    none3: await matter('No manager three', null, null),
    clean: await matter('Alpha clean', pmA, null),
    noAssign: await matter('NoAssign own', pmNoAssign, null),
    otherClient: null as unknown as PmMatter,
  };

  // A client whose only matter nobody manages: the Clients list in "My matters" must not show it.
  const other = await seed.client({ name: `Other Client ${token}` });
  const otherMatter = await seed.matter({
    client: other,
    number: '00001',
    name: `Other client one ${token}`,
  });
  m.otherClient = {
    matterId: otherMatter.matterId,
    matterRef: otherMatter.matterRef,
    name: otherMatter.name,
  };
  const otherClient: PmClient = {
    clientId: other.clientId,
    clientNumber: other.clientNumber,
    name: other.name,
  };
  const record = (r: { name?: string; displayName?: string }, id: number): PmRecord => ({
    id,
    name: (r.displayName ?? r.name) as string,
  });
  const assetMineRow = await seed.asset(m.primary, `Scope asset mine ${token}`);
  const assetOtherRow = await seed.asset(m.solo, `Scope asset other ${token}`);
  const projectMineRow = await seed.project(m.primary, `Scope project mine ${token}`);
  const projectOtherRow = await seed.project(m.solo, `Scope project other ${token}`);
  const assetMine = record(assetMineRow, assetMineRow.assetId);
  const assetOther = record(assetOtherRow, assetOtherRow.assetId);
  const projectMine = record(projectMineRow, projectMineRow.projectId);
  const projectOther = record(projectOtherRow, projectOtherRow.projectId);

  await tasks(m.primary, 1, { dueDate: '2099-01-01' });
  await tasks(m.overdue, 1, { dueDate: '2000-01-01' });
  await tasks(m.unassigned, 2);
  await tasks(m.none1, 2); // work without a manager: nobody is flagged
  const held = (await tasks(m.hold, 1))[0];
  await seed.admin.post(`/api/v1/tasks/${held.taskId}/status`, {
    status: 'ON_HOLD',
    comment: 'Waiting for the client',
    rowVersion: held.rowVersion,
  });
  if (Seeder.canWriteLegacyText()) {
    seed.sql(
      `UPDATE dbo.Task SET StatusChangedAt = DATEADD(DAY, -10, SYSUTCDATETIME()) WHERE TaskId = ${Number(held.taskId)}`,
    );
  }

  return {
    token,
    world,
    pmA,
    pmB,
    pmNone,
    pmNoTask,
    director,
    observer,
    editor,
    away,
    pmNoAssign,
    technician,
    otherClient,
    assetMine,
    assetOther,
    projectMine,
    projectOther,
    m,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The two review personas of epic #893 (issue #925): a Project Manager with exactly ONE matter and one with exactly THREE. They have worlds of
// their own (never part of `pmFixtures`, so the counts of the Matters list specs do not move), and each gets an overdue, an unassigned, an On hold
// (for ten days) and an At risk task. The two aged states need the SQL container of `run-local.sh` (`Seeder.canWriteLegacyText()`); without it
// `aged` is false and only the overdue and unassigned tasks exist.

export interface PmPersona {
  pm: Persona;
  /** Another Project Manager: the Primary of the matter `pm` is Secondary on (three-matter persona only). */
  other: Persona;
  token: string;
  world: World;
  clients: PmClient[];
  matters: PmMatter[];
  /** True when the At risk task and the ten-day hold were aged with SQL. */
  aged: boolean;
  tasks: { overdue: Json; unassigned: Json; hold: Json; atRisk: Json };
}

async function personaWorld(
  seed: Seeder,
  personas: Personas,
  label: string,
  three: boolean,
): Promise<PmPersona> {
  const token = uid().slice(0, 5).toUpperCase();
  const world = await seed.world();
  const pm = await personas.create({
    label: `${label}-pm`,
    roles: ['Project Manager'],
    displayName: `${three ? 'PM Three' : 'PM Solo'} ${label} ${token}`,
  });
  const other = await personas.create({
    label: `${label}-pm2`,
    roles: ['Project Manager'],
    displayName: `PM Other ${label} ${token}`,
  });
  // Three clients for the three-matter persona (the Client filter is then offered); one for the solo persona.
  const clients: PmClient[] = [];
  const makeClient = async (name: string): Promise<Json> => {
    const c = await seed.client({ name: `${name} ${token}` });
    clients.push({ clientId: c.clientId, clientNumber: c.clientNumber, name: c.name });
    return c;
  };
  const manage = async (m: Json, primary: Persona | null, secondary: Persona | null) => {
    await seed.admin.put(`/api/v1/matters/${m.matterId}/managers`, {
      primaryManagerId: primary?.userId ?? null,
      secondaryManagerId: secondary?.userId ?? null,
      rowVersion: m.rowVersion,
    });
    return { matterId: m.matterId, matterRef: m.matterRef, name: m.name } as PmMatter;
  };
  const matters: PmMatter[] = [];
  if (three) {
    const c1 = await makeClient('Alpha');
    const c2 = await makeClient('Beta');
    const c3 = await makeClient('Gamma');
    const one = await seed.matter({
      client: c1,
      number: '00001',
      name: `Three one ${label} ${token}`,
    });
    const two = await seed.matter({
      client: c2,
      number: '00001',
      name: `Three two ${label} ${token}`,
    });
    const tri = await seed.matter({
      client: c3,
      number: '00001',
      name: `Three three ${label} ${token}`,
    });
    matters.push(
      await manage(one, pm, null),
      await manage(two, pm, null),
      await manage(tri, other, pm),
    );
  } else {
    const c1 = await makeClient('Solo');
    const only = await seed.matter({
      client: c1,
      number: '00001',
      name: `Solo only ${label} ${token}`,
    });
    matters.push(await manage(only, pm, null));
  }

  // The states, spread over the matters. A task type with a target turnaround makes At risk possible.
  const slow = await seed.taskType({ workflows: [world.workflow] });
  const view = await seed.admin.get(`/api/v1/task-types/${slow.id}`);
  await seed.admin.put(`/api/v1/task-types/${slow.id}`, {
    name: view.name,
    description: view.description ?? null,
    isActive: true,
    eligibleWorkflowIds: view.eligibleWorkflowIds,
    defaultWorkflowDefinitionId: view.defaultWorkflowDefinitionId,
    iconKey: view.iconKey,
    colourKey: view.colourKey ?? undefined,
    targetDays: 5,
    rowVersion: view.rowVersion,
  });
  const on = (i: number) => ({
    matter: { matterId: matters[i % matters.length].matterId },
    taskType: world.taskType,
    workflow: world.workflow,
  });
  const farOut = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  const overdue = await seed.task(on(0), { title: `Overdue ${token}`, dueDate: '2000-01-01' });
  const unassigned = await seed.task(on(1), { title: `Unassigned ${token}`, dueDate: farOut });
  const hold = await seed.task(on(2), { title: `Held ${token}`, dueDate: farOut });
  await seed.admin.post(`/api/v1/tasks/${hold.taskId}/status`, {
    status: 'ON_HOLD',
    comment: 'Waiting for the client',
    rowVersion: hold.rowVersion,
  });
  const atRisk = await seed.task(
    { ...on(0), taskType: { ...world.taskType, id: slow.id } },
    { title: `At risk ${token}`, taskTypeId: slow.id, dueDate: farOut },
  );
  const aged = Seeder.canWriteLegacyText();
  if (aged) {
    seed.sql(
      `UPDATE dbo.Task SET StatusChangedAt = DATEADD(DAY, -10, SYSUTCDATETIME()) WHERE TaskId = ${Number(hold.taskId)}`,
    );
    seed.ageTask(atRisk.taskId, { createdDaysAgo: 5 });
  }
  return {
    pm,
    other,
    token,
    world,
    clients,
    matters,
    aged,
    tasks: { overdue, unassigned, hold, atRisk },
  };
}

/** The Project Manager with exactly one matter: one overdue, one unassigned, one on hold (ten days) and one At risk task on it. */
export function pmSolo(seed: Seeder, personas: Personas, label: string): Promise<PmPersona> {
  return personaWorld(seed, personas, label, false);
}

/** The Project Manager with exactly three matters (Primary of two, Secondary of one; three clients): every state spread across them. */
export function pmThree(seed: Seeder, personas: Personas, label: string): Promise<PmPersona> {
  return personaWorld(seed, personas, label, true);
}
