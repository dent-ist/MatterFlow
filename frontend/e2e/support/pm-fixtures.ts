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
 * Idempotent per worker. The performance set (200 matters, 20,000 open tasks) belongs to #686 and is not built here.
 */
export interface PmMatter {
  matterId: number;
  matterRef: string;
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
    | 'clean',
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
  };

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

  return { token, world, pmA, pmB, pmNone, pmNoTask, director, observer, editor, away, m };
}
