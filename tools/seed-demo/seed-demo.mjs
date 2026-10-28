#!/usr/bin/env node
// Demo data seeder for a running MatterFlow API (local development, Dev authentication).
//
//   npm run seed:demo                              50 test users, Demo clients/matters/projects, 200 tasks
//   npm run seed:demo -- --tasks 50 --seed 7       another batch of 50 tasks, reproducible
//   npm run seed:demo -- --dry-run                 only prints what would be created
//
// Everything goes through the public HTTP API (as the Dev default admin, and as the test users for their own work), exactly like the
// screens do: nothing is written to the database directly. See the README section "Demo data".

import { Api, ApiError, Pacer, withRecheck } from './lib/http.mjs';
import { createRng } from './lib/rng.mjs';
import { FormFiller } from './lib/forms.mjs';
import { choosablePool } from './lib/assets.mjs';
import { ageDemoTasks, assertLocal, sqlFromOptions } from './lib/aged.mjs';
import {
  CANCEL_REASONS,
  CLIENT_NAMES,
  COMMENTS,
  DESCRIPTION_LINES,
  FIRST_NAMES,
  HOLD_REASONS,
  LAST_NAMES,
  MATTER_NAMES,
  PROJECT_NAMES,
  SKIP_COMMENTS,
} from './lib/data.mjs';

const FIRM_ZONE = 'America/New_York';
const DEMO_CLIENT_BASE = 90001; // Demo clients are numbered 90001..90005
const DEMO_MATTER_BASE = 80001; // Demo matters 80001..80012 (five digits, unique within their client)
// Sensitive Demo matters (epic #788): by position in MATTER_NAMES. Index 5 gets a manager (the plan in ensureManagers), index 9 gets none, so the demo
// shows both cases: a sensitive matter people manage and one that only holders of Matter.ViewSensitive and the people assigned a task on it can see.
const SENSITIVE_MATTER_INDEXES = new Set([5, 9]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Options

const HELP = `MatterFlow demo data seeder

Usage: npm run seed:demo -- [options]      (node tools/seed-demo/seed-demo.mjs [options])

  --api <url>       API origin (default $SEED_API or http://localhost:5080; the Angular dev server on :4200 works too)
  --admin <account> Dev-auth account that acts as System Admin (default $SEED_ADMIN or KE\\kekim)
  --users <n>       test users Test User 01.. (default 50): only missing ones are created
  --tasks <n>       tasks to create (default 200). Without this option nothing is added when demo tasks already exist;
                    with it, a new batch of n tasks is always added
  --seed <n>        seed of the random sequence (default: random, printed); the same seed plans the same data
  --tag <text>      run tag put into the requestor name of the tasks of this run (default: generated, e.g. D4X9K)
  --concurrency <n> tasks worked in parallel (default 3)
  --aged            also move dates back so the screens have realistic states (issue #925): open tasks that used 80 percent of their
                    task type's target turnaround (At risk) and tasks that have been On hold for 3 to 21 days. The API cannot do this (it
                    creates every task "now"), so this one step runs UPDATE statements inside the local development SQL Server container
                    (docker exec). Local API only; only Demo tasks (requestor "[demo <tag>]"); safe to repeat. Needs Docker.
  --sql-container <name>  the SQL Server container for --aged (default $SEED_SQL_CONTAINER or matterflow-sql)
  --sql-password <pw>     its sa password (default $SEED_SQL_PASSWORD or the development password of docker-compose.dev.yml)
  --dry-run         read the system and print the plan, create nothing
  --help

Every option also exists as an environment variable: SEED_API, SEED_ADMIN, SEED_USERS, SEED_TASKS, SEED_SEED, SEED_TAG,
SEED_CONCURRENCY, SEED_AGED=1, SEED_SQL_CONTAINER, SEED_SQL_PASSWORD, SEED_DRY_RUN=1.`;

function parseArgs(argv) {
  const env = process.env;
  const opts = {
    api: env.SEED_API ?? 'http://localhost:5080',
    admin: env.SEED_ADMIN ?? 'KE\\kekim',
    users: env.SEED_USERS !== undefined ? Number(env.SEED_USERS) : 50,
    tasks: env.SEED_TASKS !== undefined ? Number(env.SEED_TASKS) : 200,
    tasksGiven: env.SEED_TASKS !== undefined,
    seed: env.SEED_SEED !== undefined ? Number(env.SEED_SEED) : undefined,
    tag: env.SEED_TAG,
    concurrency: env.SEED_CONCURRENCY !== undefined ? Number(env.SEED_CONCURRENCY) : 3,
    dryRun: env.SEED_DRY_RUN === '1' || env.SEED_DRY_RUN === 'true',
    aged: env.SEED_AGED === '1' || env.SEED_AGED === 'true',
    sqlContainer: env.SEED_SQL_CONTAINER ?? 'matterflow-sql',
    sqlPassword: env.SEED_SQL_PASSWORD ?? 'MatterFlow_Dev1!',
  };
  const takesValue = new Set([
    'api',
    'admin',
    'users',
    'tasks',
    'seed',
    'tag',
    'concurrency',
    'sql-container',
    'sql-password',
  ]);
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    }
    if (!arg.startsWith('--')) fail(`Unexpected argument "${arg}". Try --help.`);
    let name = arg.slice(2);
    let value;
    const eq = name.indexOf('=');
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (name === 'dry-run') {
      opts.dryRun = value === undefined || value === 'true' || value === '1';
      continue;
    }
    if (name === 'aged') {
      opts.aged = value === undefined || value === 'true' || value === '1';
      continue;
    }
    if (!takesValue.has(name)) fail(`Unknown option --${name}. Try --help.`);
    if (value === undefined) value = argv[++i];
    if (value === undefined) fail(`Option --${name} needs a value.`);
    if (name === 'tasks') opts.tasksGiven = true;
    if (name === 'sql-container') opts.sqlContainer = value;
    else if (name === 'sql-password') opts.sqlPassword = value;
    else opts[name] = ['api', 'admin', 'tag'].includes(name) ? value : Number(value);
  }
  for (const key of ['users', 'tasks', 'concurrency']) {
    if (!Number.isInteger(opts[key]) || opts[key] < 0 || opts[key] > 1000)
      fail(`--${key} must be a whole number from 0 to 1000.`);
  }
  if (opts.concurrency < 1) fail('--concurrency must be at least 1.');
  if (opts.seed !== undefined && !Number.isInteger(opts.seed))
    fail('--seed must be a whole number.');
  opts.seed ??= Math.floor(Math.random() * 1_000_000);
  opts.tag ??= `D${Date.now().toString(36).slice(-4).toUpperCase()}`;
  return opts;
}

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

/** Creates something once: after an ambiguous failure (the server may have committed) it first looks whether the thing exists now. */
const ensure = (find, create) =>
  withRecheck(async (attempt) => {
    if (attempt > 0) {
      const existing = await find();
      if (existing) return existing;
    }
    return create();
  });

const pad = (n, width) => String(n).padStart(width, '0');
const log = (message = '') => console.log(message);
const step = (message) => console.log(`\n== ${message}`);

function dateInZone(offsetDays) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FIRM_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Discovery

async function discover(admin) {
  let me;
  try {
    me = await admin.get('/api/v1/me');
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      fail(
        `The API answered ${error.status} for ${admin.user}. The seeder needs the Dev authentication provider (ASPNETCORE_ENVIRONMENT=Development, ` +
          `started with "npm start" or "npm run api") and an account that is a System Admin (Bootstrap__SystemAdmins__0 = KE\\kekim). ` +
          `Use --admin to name another admin.`,
      );
    }
    if (error instanceof ApiError && error.status === 400) {
      fail(`The API refused the request: ${error.message}`);
    }
    throw error;
  }
  const needed = [
    'User.Manage',
    'User.View',
    'Task.Create',
    'Task.Assign',
    'Task.SetPriority',
    'Client.Create',
    'Matter.Create',
    'Pod.Manage',
    'Asset.Create',
  ];
  const missing = needed.filter((p) => !me.permissions.includes(p));
  if (me.status !== 'ACTIVE' || missing.length > 0) {
    fail(
      `${admin.user} cannot seed: status ${me.status}, missing permissions: ${missing.join(', ') || 'none'}. Use a System Admin (--admin).`,
    );
  }

  const [roles, pods, priorities, taskTypes, assetTypes] = await Promise.all([
    admin.get('/api/v1/roles'),
    admin.getAll('/api/v1/pods'),
    admin.get('/api/v1/priorities'),
    admin.get('/api/v1/task-types'),
    admin.getAll('/api/v1/asset-types'),
  ]);
  // PM v2 (epic #851): the admin list of on-hold reasons; older servers have none, then tasks are put on hold with the comment only.
  const onHoldReasons = await admin
    .get('/api/v1/on-hold-reasons')
    .then((list) => (Array.isArray(list) ? list : (list.items ?? [])).filter((r) => r.isActive))
    .catch(() => []);
  const usableTypes = taskTypes.filter((t) => t.isActive && t.isUsable);
  if (usableTypes.length === 0) {
    fail(
      'The system has no usable Task Types, so no tasks can be created. Start the API with Seed__StarterConfiguration__Enabled=true ' +
        '("npm start" does this) so the starter task types, workflows and priorities are created, or configure task types under Administration.',
    );
  }
  const activePriorities = (Array.isArray(priorities) ? priorities : priorities.items)
    .filter((p) => p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (activePriorities.length === 0)
    fail('The system has no active priorities (starter configuration missing).');
  const roleByName = new Map(roles.map((r) => [r.name, r]));
  for (const name of ['Data Technician']) {
    if (!roleByName.has(name))
      fail(
        `The role "${name}" does not exist. Enable the starter configuration (Seed__StarterConfiguration__Enabled=true).`,
      );
  }
  return {
    me,
    roles,
    roleByName,
    pods: pods.filter((p) => p.isActive),
    priorities: activePriorities,
    taskTypes: usableTypes,
    assetTypes: assetTypes.filter((a) => a.isActive),
    onHoldReasons,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Users

function roleNameFor(i) {
  // Test User 02 is a Director: by default the Director role holds Matter.ViewSensitive, so this person sees every sensitive Demo matter (epic #788).
  if (i === 2) return 'Director';
  if (i % 12 === 6) return 'Pod Lead';
  if (i % 16 === 3) return 'Project Manager';
  if (i % 5 === 2 || i % 9 === 0) return 'Data Scientist';
  return 'Data Technician';
}

/** Availability profile of the test users who are out of office (by number). */
function outOfOfficeFor(i) {
  if (i === 5) return { note: 'Annual leave', untilDays: 6 };
  if (i === 19) return { note: 'Parental leave', untilDays: null };
  if (i === 33) return { note: 'Conference', untilDays: 2 };
  if (i === 41) return { note: 'Sick leave', untilDays: 3 };
  return null;
}

function podIdsFor(i, pods) {
  if (pods.length === 0 || i % 11 === 0) return { podIds: [], primary: null };
  const first = pods[(i - 1) % pods.length].podId;
  const ids = [first];
  if (pods.length > 1 && i % 4 === 0) ids.push(pods[i % pods.length].podId);
  return { podIds: [...new Set(ids)], primary: first };
}

async function ensurePods(admin, ctx, opts, summary) {
  if (ctx.pods.length > 0) {
    log(`Pods: ${ctx.pods.length} exist, reusing them.`);
    return;
  }
  const names = [
    'Demo Processing Pod',
    'Demo Production Pod',
    'Demo Analytics Pod',
    'Demo Workspace Support Pod',
  ];
  log(`Pods: none exist, ${opts.dryRun ? 'would create' : 'creating'} ${names.length}.`);
  summary.podsCreated = names.length;
  if (opts.dryRun) return;
  for (const name of names) {
    const pod = await ensure(
      async () =>
        (await admin.getAll(`/api/v1/pods?q=${encodeURIComponent(name)}`)).find(
          (p) => p.name === name,
        ),
      async () => (await admin.post('/api/v1/pods', { name })).pod,
    );
    ctx.pods.push(pod);
  }
}

async function ensureUsers(admin, ctx, opts, summary) {
  const domain = admin.user.includes('\\') ? admin.user.split('\\')[0] : 'KE';
  const existing = new Map();
  for (const u of await admin.getAll('/api/v1/users?status=all&search=testuser'))
    existing.set(u.windowsAccount.toLowerCase(), u);

  const todo = [];
  ctx.users = []; // index 0 is Test User 01
  for (let i = 1; i <= opts.users; i++) {
    const account = `${domain}\\testuser${pad(i, 2)}`;
    const found = existing.get(account.toLowerCase());
    const entry = {
      i,
      account,
      roleName: roleNameFor(i),
      displayName: `Test User ${pad(i, 2)}`,
      userId: found?.userId ?? null,
      podIds: (found?.pods ?? []).map((p) => p.podId),
    };
    ctx.users.push(entry);
    // A user a previous interrupted run left without role is finished; complete users are skipped.
    if (!found || (found.roles.length === 0 && found.isActive)) todo.push({ entry, found });
  }
  summary.usersExisting = opts.users - todo.length;
  summary.usersCreated = 0;
  summary.usersFinished = 0;
  log(
    `Users: ${summary.usersExisting} of ${opts.users} already set up, ${todo.length} to create or finish.`,
  );
  if (opts.dryRun || todo.length === 0) return;

  let done = 0;
  await pool(todo, 4, async ({ entry, found }) => {
    // Every step reads before it writes, so repeating the whole routine after a database deadlock is safe.
    await withRecheck(async () => {
      if (!found) {
        // The first sign-in of an unknown Dev account provisions it (Access Pending), the way the app does.
        await admin.as(entry.account).get('/api/v1/me');
      }
      const list = await admin.get(
        `/api/v1/users?status=all&search=${encodeURIComponent(entry.account)}`,
      );
      const summaryRow = list.items.find(
        (u) => u.windowsAccount.toLowerCase() === entry.account.toLowerCase(),
      );
      if (!summaryRow) throw new Error(`User ${entry.account} was not provisioned`);
      entry.userId = summaryRow.userId;
      const detail = await admin.get(`/api/v1/users/${entry.userId}`);
      const profile = await admin.put(`/api/v1/users/${entry.userId}`, {
        displayName: entry.displayName,
        email: `testuser${pad(entry.i, 2)}@example.test`,
        rowVersion: detail.rowVersion,
      });
      await admin.put(`/api/v1/users/${entry.userId}/roles`, {
        roleIds: [
          ctx.roleByName.get(entry.roleName)?.roleId ??
            ctx.roleByName.get('Data Technician').roleId,
        ],
        rowVersion: profile.rowVersion,
      });
      const pods = podIdsFor(entry.i, ctx.pods);
      if (pods.podIds.length > 0) {
        await admin.put(`/api/v1/users/${entry.userId}/pods`, {
          podIds: pods.podIds,
          primaryPodId: pods.primary,
        });
      }
      entry.podIds = pods.podIds;
      const away = outOfOfficeFor(entry.i);
      if (away) {
        const current = await admin.get(`/api/v1/users/${entry.userId}/availability`);
        await admin.put(`/api/v1/users/${entry.userId}/availability`, {
          status: 'OUT_OF_OFFICE',
          from: null,
          until: away.untilDays ? dateInZone(away.untilDays) : null,
          note: away.note,
          timeZoneId: null,
          workHours: null,
          rowVersion: current.rowVersion,
        });
        entry.outOfOffice = true;
      }
    });
    summary[found ? 'usersFinished' : 'usersCreated']++;
    done++;
    if (done % 10 === 0 || done === todo.length) log(`  users ${done}/${todo.length}`);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Clients, matters, projects, assets

async function ensureOrganization(admin, ctx, opts, summary) {
  const clients = await admin.getAll('/api/v1/clients?q=Demo');
  const matters = await admin.getAll('/api/v1/matters?q=Demo');
  const demoClients = [];
  const demoMatters = [];
  summary.clientsCreated = 0;
  summary.mattersCreated = 0;
  summary.projectsCreated = 0;
  summary.assetsCreated = 0;

  for (let c = 0; c < CLIENT_NAMES.length; c++) {
    const number = pad(DEMO_CLIENT_BASE + c, 5);
    const name = `Demo ${CLIENT_NAMES[c]}`;
    let client = clients.find((x) => x.clientNumber === number || x.name === name);
    if (!client) {
      summary.clientsCreated++;
      if (!opts.dryRun)
        client = await ensure(
          async () =>
            (await admin.getAll(`/api/v1/clients?q=${encodeURIComponent(name)}`)).find(
              (x) => x.name === name,
            ),
          () => admin.post('/api/v1/clients', { clientNumber: number, name }),
        );
      else client = { clientId: null, clientNumber: number, name };
    }
    demoClients.push(client);
  }
  for (let m = 0; m < MATTER_NAMES.length; m++) {
    const client = demoClients[m % demoClients.length];
    const number = pad(DEMO_MATTER_BASE + m, 5);
    const name = `Demo ${MATTER_NAMES[m]}`;
    let matter = matters.find((x) => x.name === name && x.clientNumber === client.clientNumber);
    if (!matter) {
      summary.mattersCreated++;
      if (!opts.dryRun) {
        matter = await ensure(
          async () =>
            (await admin.getAll(`/api/v1/matters?clientId=${client.clientId}`)).find(
              (x) => x.name === name,
            ),
          () =>
            admin.post('/api/v1/matters', {
              clientId: client.clientId,
              matterNumber: number,
              name,
              isSensitive: SENSITIVE_MATTER_INDEXES.has(m),
            }),
        );
      } else {
        matter = {
          matterId: null,
          matterRef: `${client.clientNumber}-${number}`,
          name,
          isActive: true,
          isSensitive: SENSITIVE_MATTER_INDEXES.has(m),
        };
      }
    }
    demoMatters.push(matter);
  }
  log(
    `Clients: ${demoClients.length - summary.clientsCreated} found, ${summary.clientsCreated} ${opts.dryRun ? 'to create' : 'created'}. ` +
      `Matters: ${demoMatters.length - summary.mattersCreated} found, ${summary.mattersCreated} ${opts.dryRun ? 'to create' : 'created'}.`,
  );

  // Projects: four Demo projects on different matters (tasks of those matters are spread over them).
  ctx.projectsByMatter = new Map();
  const projects = opts.dryRun ? [] : await admin.getAll('/api/v1/projects?q=Demo');
  for (let p = 0; p < PROJECT_NAMES.length; p++) {
    const matter = demoMatters[p * 3];
    const name = `Demo ${PROJECT_NAMES[p]}`;
    let project = projects.find((x) => x.name === name && x.matterId === matter.matterId);
    if (!project) {
      summary.projectsCreated++;
      if (!opts.dryRun)
        project = await ensure(
          async () =>
            (await admin.getAll(`/api/v1/projects?matterId=${matter.matterId}`)).find(
              (x) => x.name === name,
            ),
          () => admin.post('/api/v1/projects', { matterId: matter.matterId, name }),
        );
    }
    if (project) ctx.projectsByMatter.set(matter.matterId, project);
  }
  ctx.matters = demoMatters.filter((m) => m.isActive !== false);

  // Assets: task request forms and workflow steps refer to workspaces, media and data sets, so every Demo matter gets a few.
  ctx.assetPool = new Map(); // matterId -> [{ assetId, assetTypeId }]
  const wanted = [
    'Relativity Workspace',
    'Harvey Vault',
    'Physical Media',
    'Collection / Data Set',
    'Production',
  ];
  const types = wanted.map((name) => ctx.assetTypes.find((t) => t.name === name)).filter(Boolean);
  const filler = new FormFiller(admin, createRng(opts.seed ^ 0x5eed), {
    assetIdsFor: (matterId) => (ctx.assetPool.get(matterId) ?? []).map((a) => a.assetId),
    userIds: [],
  });
  for (const matter of demoMatters) {
    if (matter.matterId === null) {
      summary.assetsCreated += types.length;
      continue;
    }
    const have = await admin.getAll(`/api/v1/assets?matterId=${matter.matterId}`);
    // Only Active assets: a re-run finds the ones an earlier run moved off Active (ensureDispositions) and a task form refuses those.
    ctx.assetPool.set(matter.matterId, choosablePool(have));
    const haveTypes = new Set(have.map((a) => a.assetTypeId));
    for (const type of types) {
      if (haveTypes.has(type.assetTypeId)) continue;
      if (opts.dryRun) {
        summary.assetsCreated++;
        continue;
      }
      try {
        const formValues = type.publishedFormVersionId
          ? await filler.fill(type.publishedFormVersionId, matter.matterId)
          : {};
        const displayName =
          type.name === 'Relativity Workspace'
            ? `${matter.matterRef} - ${matter.name}`
            : `Demo ${type.name} ${matter.matterRef}`;
        const asset = await ensure(
          async () =>
            (await admin.getAll(`/api/v1/assets?matterId=${matter.matterId}`)).find(
              (x) => x.displayName === displayName,
            ),
          () =>
            admin.post('/api/v1/assets', {
              matterId: matter.matterId,
              assetTypeId: type.assetTypeId,
              displayName,
              externalReference: null,
              description: null,
              formValues,
            }),
        );
        ctx.assetPool
          .get(matter.matterId)
          .push({ assetId: asset.assetId, assetTypeId: type.assetTypeId });
        summary.assetsCreated++;
      } catch (error) {
        log(
          `  (asset type "${type.name}" skipped for ${matter.matterRef}: ${error.message.slice(0, 160)})`,
        );
      }
    }
  }
  log(
    `Projects: ${summary.projectsCreated} ${opts.dryRun ? 'to create' : 'created'}. Assets: ${summary.assetsCreated} ${opts.dryRun ? 'to create' : 'created'}.`,
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Task plan (pure: uses the seeded random generator only)

const STATE_SHARES = [
  ['NEW', 0.2],
  ['IN_PROGRESS', 0.37],
  ['ON_HOLD', 0.1],
  ['COMPLETED', 0.25],
  ['CANCELLED', 0.08],
];

function splitByShares(total, shares) {
  const raw = shares.map(([key, share]) => [key, share * total]);
  const counts = raw.map(([key, value]) => [key, Math.floor(value), value - Math.floor(value)]);
  let left = total - counts.reduce((sum, [, n]) => sum + n, 0);
  for (const entry of [...counts].sort((a, b) => b[2] - a[2])) {
    if (left <= 0) break;
    entry[1]++;
    left--;
  }
  return counts.map(([key, n]) => [key, n]);
}

/** Tasks per type: every type gets at least `floor` tasks, the rest is spread with a heavy skew (a few busy types, some quiet ones). */
function countsPerType(total, types, rng) {
  const floor = Math.min(3, Math.floor(total / types.length));
  const counts = new Map(types.map((t) => [t.id, floor]));
  const weights = types.map(() => rng.next() ** 2.4 + 0.03);
  for (let i = 0; i < total - floor * types.length; i++) {
    const t = rng.weighted(types, weights);
    counts.set(t.id, counts.get(t.id) + 1);
  }
  return counts;
}

function planTasks(total, ctx, opts, rng) {
  const types = ctx.taskTypes;
  const counts = countsPerType(total, types, rng);
  const typeOrder = [];
  for (const t of types) for (let k = 0; k < counts.get(t.id); k++) typeOrder.push(t);
  const typeList = rng.shuffle(typeOrder);

  const states = [];
  for (const [state, n] of splitByShares(total, STATE_SHARES))
    for (let k = 0; k < n; k++) states.push(state);
  const stateList = rng.shuffle(states);

  // Assignee weights: a few heavily loaded users, most normal, about one in six idle.
  const userCount = ctx.users.length;
  const weights = ctx.assignees.map(() => rng.next() ** 2.2 * 3.5 + 1.5);
  const order = rng.shuffle(ctx.users.map((_, k) => k));
  order.slice(0, Math.max(1, Math.round(userCount * 0.16))).forEach((k) => (weights[k] = 0));
  order.slice(-Math.max(1, Math.round(userCount * 0.1))).forEach((k) => (weights[k] *= 2.5));
  // The admin (the person running the app) gets a share too, so My Work shows active, due soon and completed tasks.
  weights[ctx.assignees.length - 1] = 9;
  // The Director only oversees (and sees every sensitive matter): no tasks, so the demo has one person who sees all and works nothing.
  ctx.assignees.forEach((a, j) => {
    if (a.roleName === 'Director') weights[j] = 0;
  });

  const priorityWeights = ctx.priorities.map((p) =>
    p.isDefault
      ? 55
      : p.sortOrder === ctx.priorities[0].sortOrder
        ? 8
        : p.sortOrder === ctx.priorities[1]?.sortOrder
          ? 22
          : 15,
  );

  const typeSeq = new Map();
  const plans = [];
  for (let k = 0; k < total; k++) {
    const type = typeList[k];
    const state = stateList[k];
    const open = state === 'NEW' || state === 'IN_PROGRESS' || state === 'ON_HOLD';
    const matterIndex = rng.int(0, ctx.matters.length - 1);
    const priority = rng.weighted(ctx.priorities, priorityWeights);

    // Due date: open tasks are ~20% overdue, ~20% due in the next 2 days, ~15% ASAP (no date), the rest later. Closed tasks keep a spread of dates.
    let dueOffset = null;
    let dueKind;
    const roll = rng.next();
    if (open) {
      if (roll < 0.2) [dueOffset, dueKind] = [-rng.int(2, 25), 'overdue'];
      else if (roll < 0.4) [dueOffset, dueKind] = [rng.int(0, 2), 'soon'];
      else if (roll < 0.55) [dueOffset, dueKind] = [null, 'asap'];
      else [dueOffset, dueKind] = [rng.int(3, 45), 'later'];
    } else if (roll < 0.15) [dueOffset, dueKind] = [null, 'asap'];
    else if (roll < 0.75) [dueOffset, dueKind] = [-rng.int(1, 80), 'past'];
    else [dueOffset, dueKind] = [rng.int(3, 30), 'later'];

    // Assignment. New tasks wait in the queue; the others have an assignee, except a few that were unassigned again.
    let assigneeIndex = null;
    let unassignLater = false;
    if (state !== 'NEW') {
      assigneeIndex = rng.weighted(
        ctx.assignees.map((_, j) => j),
        weights,
      );
      unassignLater =
        (state === 'ON_HOLD' && rng.chance(0.28)) ||
        (state === 'CANCELLED' && rng.chance(0.4)) ||
        (state === 'IN_PROGRESS' && rng.chance(0.04));
    }
    const creatorIndex = rng.chance(0.3) ? rng.int(0, userCount - 1) : null; // null = the admin
    const daysAgo = open ? rng.int(0, 30) : rng.int(4, 90);
    plans.push({
      k,
      type,
      state,
      matterIndex,
      priority,
      dueOffset,
      dueKind,
      assigneeIndex,
      unassignLater,
      creatorIndex,
      useProject: rng.chance(0.6),
      podForQueue: state === 'NEW' && rng.chance(0.5),
      progress:
        state === 'IN_PROGRESS'
          ? rng.chance(0.6)
            ? rng.next()
            : 0
          : state === 'ON_HOLD'
            ? rng.chance(0.5)
              ? rng.next()
              : 0
            : state === 'CANCELLED'
              ? rng.chance(0.4)
                ? rng.next()
                : 0
              : 1,
      reopen: state === 'COMPLETED' && rng.chance(0.06),
      comments: rng.chance(0.25) ? rng.int(1, 3) : 0,
      requestedDaysAgo: daysAgo,
      requestorName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} [demo ${opts.tag}]`,
      description: rng.pick(DESCRIPTION_LINES),
      holdReason: rng.pick(HOLD_REASONS),
      cancelReason: rng.pick(CANCEL_REASONS),
      skipRoll: rng.next(),
      workflowPick: rng.next(),
    });
  }
  // Tasks of one type are numbered in creation order.
  for (const plan of plans) {
    typeSeq.set(plan.type.id, (typeSeq.get(plan.type.id) ?? 0) + 1);
    plan.seq = typeSeq.get(plan.type.id);
  }
  return plans;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Task execution

/**
 * Project managers on the Demo matters (epic #667): a spread of cases for the Matters list, the matter header and My Matters: Primary only,
 * a Secondary without a Primary, a manager who is out of office, and four matters with no manager (which is normal).
 * Only matters that have no manager yet are touched, so a re-run, or a change somebody made by hand, is never overwritten.
 * The two review personas (issue #925) are the exception, see `ensurePersonas`.
 */
async function ensureManagers(admin, ctx, opts, summary) {
  summary.managersSet = 0;
  const people = ctx.users.filter((u) => u.roleName === 'Project Manager' && u.userId !== null);
  if (people.length < 2) {
    log('Project managers: fewer than two Project Manager test users, no managers assigned.');
    return;
  }
  const [a, b, c] = [people[0], people[1], people[2] ?? people[0]];
  // matter index -> [primary, secondary]. Since issue #925 the second person manages exactly three matters (3, 4 and 6) and the third exactly one
  // (7), so the demo has a Project Manager with one matter and one with three (ensurePersonas keeps this true on a database seeded earlier).
  const plan = [
    [a, null],
    [a, null],
    [a, null],
    [b, null],
    [null, b],
    [a, null],
    [b, null],
    [c, null],
  ];
  const matters = ctx.matters.filter((m) => m.matterId !== null);
  for (let m = 0; m < plan.length && m < matters.length; m++) {
    const [primary, secondary] = plan[m];
    const matter = matters[m];
    if (matter.primaryManager || matter.secondaryManager) continue;
    summary.managersSet++;
    if (opts.dryRun) continue;
    const current = await admin.get(`/api/v1/matters/${matter.matterId}`);
    await admin.put(`/api/v1/matters/${matter.matterId}/managers`, {
      primaryManagerId: primary?.userId ?? undefined,
      secondaryManagerId: secondary?.userId ?? undefined,
      rowVersion: current.rowVersion,
    });
  }
  log(`Project managers: ${summary.managersSet} matters ${opts.dryRun ? 'to get' : 'got'} managers.`);
}

/** The two review personas of issue #925 (positions in the Demo matter list): the Project Manager with ONE matter and the one with THREE. */
const PERSONA_MATTERS = {
  solo: { 7: 'primary' },
  three: { 3: 'primary', 4: 'secondary', 6: 'primary' },
};

/**
 * Makes the personas true on any database (issue #925): the third Project Manager test user (Test User 35) manages exactly one Demo matter, the
 * second (Test User 19) exactly three, one Primary and one Secondary among them. A matter such a person managed before and no longer should is
 * given to the first Project Manager (as Primary) or left without a Secondary. Demo data only: this does overwrite a manager on those matters.
 */
async function ensurePersonas(admin, ctx, opts, summary) {
  summary.personaChanges = 0;
  const people = ctx.users.filter((u) => u.roleName === 'Project Manager' && u.userId !== null);
  const matters = ctx.matters.filter((m) => m.matterId !== null);
  if (people.length < 3 || matters.length < 8) {
    log('Personas: fewer than three Project Manager test users or eight Demo matters, no one-matter / three-matter Project Manager.');
    ctx.personas = null;
    return;
  }
  const [filler, three, solo] = people;
  ctx.personas = { solo, three };
  const wanted = [
    [solo, PERSONA_MATTERS.solo],
    [three, PERSONA_MATTERS.three],
  ];
  for (let i = 0; i < matters.length; i++) {
    const matter = await admin.get(`/api/v1/matters/${matters[i].matterId}`);
    let primary = matter.primaryManager?.userId ?? null;
    let secondary = matter.secondaryManager?.userId ?? null;
    for (const [person, want] of wanted) {
      const role = want[i];
      if (role === 'primary') primary = person.userId;
      else if (role === 'secondary') secondary = person.userId;
      else {
        if (primary === person.userId) primary = filler.userId;
        if (secondary === person.userId) secondary = null;
      }
    }
    if (primary !== null && primary === secondary) secondary = null;
    if (primary === (matter.primaryManager?.userId ?? null) && secondary === (matter.secondaryManager?.userId ?? null))
      continue;
    summary.personaChanges++;
    if (opts.dryRun) continue;
    await admin.put(`/api/v1/matters/${matter.matterId}/managers`, {
      primaryManagerId: primary ?? undefined,
      secondaryManagerId: secondary ?? undefined,
      rowVersion: matter.rowVersion,
    });
  }
  log(
    `Personas: ${solo.displayName} manages one matter, ${three.displayName} three (${summary.personaChanges} matters ${opts.dryRun ? 'to change' : 'changed'}).`,
  );
}

/** Task types that get a target turnaround when they have none (issue #925): Production and Analytics work, so those tasks can be At risk. */
const DEMO_TARGETS = {
  'Production (Outgoing)': 5,
  'Incoming Production Intake': 4,
  'Analytics / TAR Setup': 6,
};

async function ensureDemoTargets(admin, ctx, opts, summary) {
  summary.targetsSet = 0;
  for (const type of ctx.taskTypes) {
    const days = DEMO_TARGETS[type.name];
    if (!days || type.targetDays) continue;
    summary.targetsSet++;
    if (opts.dryRun) continue;
    const fresh = await admin.get(`/api/v1/task-types/${type.id}`);
    if (fresh.targetDays) continue;
    await admin.put(`/api/v1/task-types/${type.id}`, {
      name: fresh.name,
      description: fresh.description ?? null,
      isActive: fresh.isActive,
      eligibleWorkflowIds: fresh.eligibleWorkflowIds,
      defaultWorkflowDefinitionId: fresh.defaultWorkflowDefinitionId ?? null,
      iconKey: fresh.iconKey,
      colourKey: fresh.colourKey ?? null,
      targetDays: days,
      rowVersion: fresh.rowVersion,
    });
  }
  if (!opts.dryRun) {
    // The plan below picks task types by their target, so read the list again.
    const again = await admin.get('/api/v1/task-types');
    ctx.taskTypes = again.filter((t) => t.isActive && t.isUsable);
  }
  log(`Task types given a target turnaround for the demo (Production and Analytics): ${summary.targetsSet}.`);
}

/**
 * Tasks for the two personas (issue #925), created only where the persona's matters lack the state: an overdue task, an unassigned task, a task On
 * hold and a task that will be At risk. Through the API like every other task; the At risk and the aged hold only exist after `--aged` has moved
 * their dates (the candidates carry "[persona risk]" in the requestor name so the aging step always takes them, and a repeat run adds none).
 */
async function ensurePersonaTasks(admin, ctx, opts, summary) {
  summary.personaTasks = 0;
  if (!ctx.personas) return;
  if (opts.dryRun) {
    log('Persona tasks: not planned in a dry run.');
    return;
  }
  const matters = ctx.matters.filter((m) => m.matterId !== null);
  const technicians = ctx.assignees
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => a.roleName === 'Data Technician' && a.userId !== null && !a.outOfOffice);
  const withTarget = ctx.taskTypes.filter((t) => t.targetDays);
  const any = ctx.taskTypes;
  if (technicians.length === 0 || ctx.priorities.length === 0) return;
  const priority = ctx.priorities.find((p) => p.isDefault) ?? ctx.priorities[0];
  const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
  const kinds = [
    { key: 'overdue', state: 'IN_PROGRESS', due: -6, find: `overdue=true&${OPEN}` },
    { key: 'unassigned', state: 'NEW', due: 5, find: `unassigned=true&${OPEN}` },
    { key: 'hold', state: 'ON_HOLD', due: 12, find: `status=ON_HOLD&q=${encodeURIComponent('[persona hold]')}`, marker: '[persona hold]' },
    { key: 'risk', state: 'IN_PROGRESS', due: 20, find: 'atRisk=true', marker: '[persona risk]' },
  ];
  const plans = [];
  let n = 0;
  for (const [who, want] of [
    ['solo', PERSONA_MATTERS.solo],
    ['three', PERSONA_MATTERS.three],
  ]) {
    const own = Object.keys(want).map((i) => matters[Number(i)]);
    // A state is needed once across the persona's matters; with three matters the kinds are spread over them (overdue on the first, and so on).
    for (const [k, kind] of kinds.entries()) {
      let have = 0;
      for (const m of own) {
        have += (await admin.get(`/api/v1/task-queue?matter=${m.matterId}&${kind.find}&pageSize=1`)).total;
        if (kind.marker)
          have += (
            await admin.get(
              `/api/v1/task-queue?matter=${m.matterId}&q=${encodeURIComponent(kind.marker)}&${OPEN}&pageSize=1`,
            )
          ).total;
      }
      if (have > 0) continue;
      const types = kind.key === 'risk' ? withTarget : any;
      if (types.length === 0) continue;
      const matter = own[k % own.length];
      plans.push({
        k: 9000 + n,
        type: types[n % types.length],
        state: kind.state,
        matterIndex: ctx.matters.indexOf(matter),
        priority,
        dueOffset: kind.due,
        dueKind: kind.key,
        assigneeIndex: kind.key === 'unassigned' ? null : technicians[n % technicians.length].index,
        unassignLater: false,
        creatorIndex: null,
        useProject: false,
        podForQueue: false,
        progress: kind.state === 'IN_PROGRESS' ? 0.3 : 0,
        reopen: false,
        comments: 0,
        requestedDaysAgo: 2,
        requestorName: `Demo Persona [demo ${opts.tag}]${kind.marker ? ` ${kind.marker}` : ''}`,
        description: `A ${kind.key} task for the ${who === 'solo' ? 'one-matter' : 'three-matter'} Project Manager.`,
        holdReason: 'Waiting for the client to confirm the scope',
        cancelReason: 'Not needed',
        skipRoll: 1,
        workflowPick: 0,
      });
      n++;
    }
  }
  summary.personaTasks = plans.length;
  if (plans.length === 0) {
    log('Persona tasks: the states exist already.');
    return;
  }
  const offsets = new Map();
  for (const type of ctx.taskTypes)
    offsets.set(type.id, (await admin.get(`/api/v1/tasks?taskTypeId=${type.id}&pageSize=1`)).total);
  const filler = new FormFiller(admin, createRng(opts.seed ^ 0x2a2a), {
    assetIdsFor: (matterId) => (ctx.assetPool.get(matterId) ?? []).map((a) => a.assetId),
    userIds: ctx.users.map((u) => u.userId),
  });
  const seqs = new Map();
  for (const plan of plans) {
    seqs.set(plan.type.id, (seqs.get(plan.type.id) ?? 0) + 1);
    plan.seq = seqs.get(plan.type.id);
    await runTask(plan, { admin, ctx, filler, offsets, opts }, {});
  }
  log(`Persona tasks: ${plans.length} created (${plans.map((p) => p.dueKind).join(', ')}).`);
}

/**
 * What the demo shows about sensitive matters (epic #788): which Demo matters are sensitive, who manages them, who holds a task on them and
 * which test accounts to sign in as to see each case. Read-only. The rule itself is switched on with Features__SensitiveMatterAccess=true.
 */
async function reportSensitive(admin, ctx) {
  const sensitive = ctx.matters.filter((m) => m.matterId !== null && m.isSensitive === true);
  if (sensitive.length === 0) {
    log('No sensitive Demo matter exists (the Demo matters were created before the demo marked two of them).');
    return;
  }
  const byId = new Map(ctx.users.map((u) => [u.userId, u]));
  const managers = new Set();
  const assignees = new Set();
  for (const matter of sensitive) {
    const detail = await admin.get(`/api/v1/matters/${matter.matterId}`);
    const tasks = await admin.getAll(`/api/v1/tasks?matterId=${matter.matterId}&pageSize=100`);
    const person = (m) => (m ? m.displayName : 'none');
    for (const m of [detail.primaryManager, detail.secondaryManager]) if (m) managers.add(m.userId);
    const who = new Set();
    for (const t of tasks) if (t.assignedUser) who.add(t.assignedUser.userId);
    for (const id of who) assignees.add(id);
    const names = [...who].map((id) => byId.get(id)?.displayName ?? 'admin').sort();
    log(
      `  ${detail.matterRef} ${detail.name}: Primary ${person(detail.primaryManager)}, Secondary ${person(detail.secondaryManager)}; ` +
        `${tasks.length} tasks, assigned to ${names.length} people${names.length > 0 ? ` (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', ...' : ''})` : ''}`,
    );
  }
  const account = (u) => u?.account ?? '-';
  const director = ctx.users.find((u) => u.roleName === 'Director');
  const manager = ctx.users.find((u) => managers.has(u.userId));
  const assignee = ctx.users.find((u) => assignees.has(u.userId) && !managers.has(u.userId));
  const unrelated = ctx.users.find(
    (u) => !assignees.has(u.userId) && !managers.has(u.userId) && u.roleName !== 'Director',
  );
  log('With Features__SensitiveMatterAccess=true, sign in as (X-Dev-User) to see each case:');
  log(`  sees all sensitive matters (Director, Matter.ViewSensitive)   ${account(director)}`);
  log(`  sees the sensitive matters they manage                        ${account(manager)}`);
  log(`  sees only the tasks assigned to them and the matter header    ${account(assignee)}`);
  log(`  sees none of them                                             ${account(unrelated)}`);
  log(
    'The admin sees everything. With the switch off (the default) every matter is visible to everybody who may view matters.',
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PM v2 (epic #851, issue #868): what the Breakdown, Data and report screens need to show something. Idempotent and polite: it only fills what is
// still empty (a task type without colour and target, an asset type without a designated size field, assets that are all still Active) and never
// overwrites what an administrator chose.

const PALETTE = ['blue', 'teal', 'green', 'amber', 'orange', 'violet', 'rose', 'indigo', 'slate', 'red'];
const TARGET_DAYS = [3, null, 5, 7, null, 2, 10, null, 4, null];

async function ensureTaskTypeColours(admin, ctx, opts, summary) {
  summary.typesStyled = 0;
  let n = 0;
  for (const type of ctx.taskTypes) {
    const i = n++;
    if (type.colourKey || type.targetDays) continue;
    summary.typesStyled++;
    if (opts.dryRun) continue;
    const fresh = await admin.get(`/api/v1/task-types/${type.id}`);
    await admin.put(`/api/v1/task-types/${type.id}`, {
      name: fresh.name,
      description: fresh.description ?? null,
      isActive: fresh.isActive,
      eligibleWorkflowIds: fresh.eligibleWorkflowIds,
      defaultWorkflowDefinitionId: fresh.defaultWorkflowDefinitionId ?? null,
      iconKey: fresh.iconKey,
      colourKey: PALETTE[i % PALETTE.length],
      targetDays: TARGET_DAYS[i % TARGET_DAYS.length],
      rowVersion: fresh.rowVersion,
    });
  }
}

/** The number field that means "size" of an asset type, and its unit: a key or label with gb, mb or tb, else the first number field counted in Items. */
function pickSizeField(schema) {
  const numbers = (schema.fields ?? []).filter((f) => f.control === 'NUMBER');
  if (numbers.length === 0) return null;
  const text = (f) => `${f.key} ${f.label ?? ''}`;
  const sized = numbers.find((f) => /\b(size|gb|mb|tb|volume)\b|_gb|_mb|_tb/i.test(text(f))) ?? numbers[0];
  const unit = /gb/i.test(text(sized)) ? 'GB' : /tb/i.test(text(sized)) ? 'TB' : /mb/i.test(text(sized)) ? 'MB' : 'Items';
  return { key: sized.key, unit };
}

async function ensureAssetSizes(admin, ctx, opts, summary) {
  summary.sizeFields = 0;
  for (const type of ctx.assetTypes) {
    if (!type.publishedFormVersionId || type.sizeFieldKey) continue;
    const field = pickSizeField(await admin.get(`/api/v1/forms/versions/${type.publishedFormVersionId}/schema`));
    if (!field) continue;
    summary.sizeFields++;
    if (opts.dryRun) continue;
    const fresh = await admin.get(`/api/v1/asset-types/${type.assetTypeId}`);
    await admin.put(`/api/v1/asset-types/${type.assetTypeId}/size-field`, {
      sizeFieldKey: field.key,
      sizeUnit: field.unit,
      rowVersion: fresh.rowVersion,
    });
  }
}

async function ensureDispositions(admin, ctx, opts, summary) {
  summary.dispositions = 0;
  const assets = [];
  for (const [matterId] of ctx.assetPool) assets.push(...(await admin.getAll(`/api/v1/assets?matterId=${matterId}`)));
  assets.sort((a, b) => a.assetId - b.assetId);
  if (assets.length === 0 || assets.some((a) => a.dispositionCode && a.dispositionCode !== 'ACTIVE')) return; // already shaped (or by hand)
  const plan = [
    [3, 'INACTIVE', null],
    [6, 'PENDING_DISPOSITION', 'Matter wrapped up; waiting for the retention sign-off'],
    [9, 'DISPOSED', 'Destroyed with the client\'s written approval'],
  ];
  for (let i = 0; i < assets.length; i++) {
    const pick = plan.find(([mod]) => i % 10 === mod);
    if (!pick) continue;
    summary.dispositions++;
    if (opts.dryRun) continue;
    const fresh = await admin.get(`/api/v1/assets/${assets[i].assetId}`);
    await admin.put(`/api/v1/assets/${assets[i].assetId}/disposition`, {
      dispositionCode: pick[1],
      note: pick[2],
      rowVersion: fresh.rowVersion,
    });
    // An asset that is no longer Active cannot be chosen in a task's form: the tasks created next must not refer to it (without this about a third
    // of the tasks of a first run failed form validation).
    const pool = ctx.assetPool.get(assets[i].matterId);
    if (pool) ctx.assetPool.set(assets[i].matterId, pool.filter((x) => x.assetId !== assets[i].assetId));
  }
}

async function ensurePmV2(admin, ctx, opts, summary) {
  await ensureTaskTypeColours(admin, ctx, opts, summary);
  await ensureAssetSizes(admin, ctx, opts, summary);
  await ensureDispositions(admin, ctx, opts, summary);
  log(
    `Task types styled (colour, target days): ${summary.typesStyled}. Asset types given a size field: ${summary.sizeFields}. Assets moved off Active: ${summary.dispositions}. ` +
      `On-hold reasons in use for held tasks: ${ctx.onHoldReasons.length}.`,
  );
}

async function pool(items, width, job) {
  let next = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await job(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function runTask(plan, env, partial) {
  const { admin, ctx, filler, offsets, opts } = env;
  const matter = ctx.matters[plan.matterIndex];
  const assignee = plan.assigneeIndex === null ? null : ctx.assignees[plan.assigneeIndex];
  // A sensitive matter is invisible to most test users (epic #788): its tasks are created and worked by the admin, who sees every matter. The planned
  // assignee still gets the task, so that person sees exactly that task (and the matter header) and nothing else of the matter.
  const sensitive = matter.isSensitive === true;
  const creator = plan.creatorIndex === null || sensitive ? null : ctx.users[plan.creatorIndex];
  const creatorApi = creator ? admin.as(creator.account) : admin;
  const actorApi = assignee && !sensitive ? admin.as(assignee.account) : admin;
  const type = plan.type;

  const workflowIds = type.eligibleWorkflowIds;
  const workflowId =
    plan.workflowPick < 0.75 && type.defaultWorkflowDefinitionId
      ? type.defaultWorkflowDefinitionId
      : workflowIds[Math.floor(plan.workflowPick * workflowIds.length) % workflowIds.length];
  const formValues = type.publishedFormVersionId
    ? await filler.fill(type.publishedFormVersionId, matter.matterId)
    : {};
  const project = plan.useProject ? ctx.projectsByMatter.get(matter.matterId) : undefined;
  const inPod = assignee?.podIds?.[0] ?? null;
  const podId = assignee
    ? inPod
    : plan.podForQueue && ctx.pods.length > 0
      ? ctx.pods[plan.k % ctx.pods.length].podId
      : null;

  const title = `${type.name} - ${offsets.get(type.id) + plan.seq}`;
  const body = {
    matterId: matter.matterId,
    ...(project ? { projectId: project.projectId } : {}),
    taskTypeId: type.id,
    workflowDefinitionId: workflowId,
    title,
    description: `<p>${plan.description}</p><p>Demo data, run ${opts.tag}.</p>`,
    requestorName: plan.requestorName,
    requestorEmail: `demo-${opts.tag.toLowerCase()}@example.test`,
    requestedAtUtc: new Date(
      Date.now() - plan.requestedDaysAgo * 86_400_000 - 3_600_000,
    ).toISOString(),
    priorityId: plan.priority.id,
    ...(plan.dueOffset === null
      ? {}
      : {
          dueDate: dateInZone(plan.dueOffset),
          dueTime: plan.k % 3 === 0 ? `${pad(9 + (plan.k % 8), 2)}:00` : undefined,
        }),
    ...(podId ? { assignedPodId: podId } : {}),
    ...(assignee ? { assignedUserId: assignee.userId } : {}),
    formValues,
  };
  let task = await withRecheck(async (attempt) => {
    if (attempt > 0) {
      // The failed attempt may have committed before it failed: use that task instead of creating a second one.
      const found = await creatorApi.get(
        `/api/v1/tasks?matterId=${matter.matterId}&q=${encodeURIComponent(title)}&pageSize=5`,
      );
      const hit = found.items.find((t) => t.title === title);
      if (hit) return creatorApi.get(`/api/v1/tasks/${hit.taskId}`);
    }
    return creatorApi.post('/api/v1/tasks', body);
  });
  partial.task = task;
  const taskPath = `/api/v1/tasks/${task.taskId}`;

  // Workflow steps, in order, as the assignee. `progress` is the fraction of steps done (1 = all of them).
  const stepCount = task.workflow.steps.length;
  let toDo =
    plan.progress >= 1 ? stepCount : Math.min(stepCount - 1, Math.floor(plan.progress * stepCount));
  if (plan.state === 'NEW') toDo = 0;
  for (let s = 0; s < toDo; s++) {
    task = await withRecheck(async () => {
      const fresh = await actorApi.get(taskPath);
      const stepInstance = fresh.workflow.steps[s];
      if (stepInstance.status === 'COMPLETED' || stepInstance.status === 'SKIPPED') return fresh;
      const base = `${taskPath}/workflow/steps/${stepInstance.stepInstanceId}`;
      if (
        stepInstance.isSkippable &&
        plan.skipRoll < 0.3 &&
        s === toDo - 1 &&
        plan.state === 'COMPLETED'
      ) {
        return (
          await actorApi.post(`${base}/skip`, {
            rowVersion: fresh.workflow.rowVersion,
            comment: SKIP_COMMENTS[plan.k % SKIP_COMMENTS.length],
          })
        ).task;
      }
      const values = stepInstance.inputFormVersionId
        ? await filler.fill(stepInstance.inputFormVersionId, matter.matterId)
        : {};
      return (
        await actorApi.post(`${base}/complete`, { rowVersion: fresh.workflow.rowVersion, values })
      ).task;
    });
  }

  // A task action that re-reads the task first (fresh row version) and recognises that an earlier attempt already did it.
  const change = (api, done, send) =>
    withRecheck(async (attempt) => {
      const fresh = await api.get(taskPath);
      if (attempt > 0 && done(fresh)) return fresh;
      return send(fresh);
    });

  // Some tasks lose their assignee again (a closed task cannot be changed, so this comes before cancelling).
  if (plan.unassignLater) {
    task = await change(
      admin,
      (t) => !t.assignedUser,
      (t) =>
        admin.post(`${taskPath}/assignment`, {
          rowVersion: t.rowVersion,
          userId: null,
          podId: t.assignedPod?.podId ?? null,
        }),
    );
  }

  switch (plan.state) {
    case 'ON_HOLD':
      task = await change(
        actorApi,
        (t) => t.status === 'ON_HOLD',
        (t) =>
          actorApi.post(`${taskPath}/status`, {
            rowVersion: t.rowVersion,
            status: 'ON_HOLD',
            comment: plan.holdReason,
            // PM v2 (#851): the structured reason, so the demo shows "on hold by reason"; chosen by position, so it does not disturb the random sequence.
            ...(ctx.onHoldReasons.length > 0
              ? { onHoldReasonId: ctx.onHoldReasons[plan.k % ctx.onHoldReasons.length].id }
              : {}),
          }),
      );
      break;
    case 'COMPLETED':
      task = await change(
        actorApi,
        (t) => t.status === 'COMPLETED',
        (t) =>
          actorApi.post(`${taskPath}/complete`, {
            rowVersion: t.rowVersion,
            completeUnresolvedSteps: false,
          }),
      );
      if (plan.reopen) {
        task = await change(
          actorApi,
          (t) => t.status === 'IN_PROGRESS',
          (t) => actorApi.post(`${taskPath}/reopen`, { rowVersion: t.rowVersion }),
        );
      }
      break;
    case 'CANCELLED': {
      const canceller = assignee && !plan.unassignLater ? actorApi : admin;
      task = await change(
        canceller,
        (t) => t.status === 'CANCELLED',
        (t) =>
          canceller.post(`${taskPath}/cancel`, {
            rowVersion: t.rowVersion,
            comment: plan.cancelReason,
          }),
      );
      break;
    }
    default:
      break;
  }

  for (let c = 0; c < plan.comments; c++) {
    const author = c % 2 === 0 ? actorApi : admin;
    await withRecheck(() =>
      author.post(`${taskPath}/comments`, {
        bodyHtml: `<p>${COMMENTS[(plan.k + c * 3) % COMMENTS.length]}</p>`,
      }),
    );
  }
  return task;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Summary

function tally(list, key) {
  const map = new Map();
  for (const item of list) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function printTable(title, rows, indent = '  ') {
  log(`${title}`);
  const width = Math.max(...rows.map(([k]) => String(k).length), 4);
  for (const [k, v] of rows) log(`${indent}${String(k).padEnd(width)}  ${v}`);
}

function summarize(rows, ctx, label) {
  // rows: [{ plan, task }]  (task is null for a dry run: the plan decides)
  const todayStr = dateInZone(0);
  const soonStr = dateInZone(2);
  const status = (r) => r.task?.status ?? (r.plan.reopen ? 'IN_PROGRESS' : r.plan.state);
  const assignedUser = (r) =>
    r.task
      ? r.task.assignedUser
        ? r.task.assignedUser.displayName
        : null
      : r.plan.assigneeIndex !== null && !r.plan.unassignLater
        ? ctx.assignees[r.plan.assigneeIndex].displayName
        : null;
  const isOpen = (r) => ['NEW', 'IN_PROGRESS', 'ON_HOLD'].includes(status(r));
  const dueOf = (r) =>
    r.task ? r.task.dueDate : r.plan.dueOffset === null ? null : dateInZone(r.plan.dueOffset);

  log(`\n${label}: ${rows.length} tasks`);
  printTable('By status', tally(rows, status));
  printTable(
    'By task type',
    tally(rows, (r) => r.plan.type.name),
  );
  printTable(
    'By priority',
    tally(rows, (r) => r.plan.priority.label),
  );
  const allAssignees = tally(
    rows.filter((r) => assignedUser(r)),
    assignedUser,
  );
  const assignees = allAssignees.filter(([name]) => name.startsWith('Test User'));
  const toAdmin = allAssignees
    .filter(([name]) => !name.startsWith('Test User'))
    .reduce((sum, [, n]) => sum + n, 0);
  const unassigned = rows.filter((r) => !assignedUser(r)).length;
  const assignedTotal = rows.length - unassigned;
  const testUsers = ctx.users.length;
  const idle = testUsers - assignees.length;
  log('By assignee');
  log(
    `  unassigned           ${unassigned} (${Math.round((unassigned / Math.max(1, rows.length)) * 100)}%)`,
  );
  log(
    `  assigned             ${assignedTotal} (${assignedTotal - toAdmin} to ${assignees.length} of ${testUsers} test users, ${toAdmin} to ${ctx.me.displayName})`,
  );
  log(`  idle test users      ${idle} without a task from this run`);
  log(
    `  busiest              ${
      assignees
        .slice(0, 5)
        .map(([n, c]) => `${n} (${c})`)
        .join(', ') || '-'
    }`,
  );
  const open = rows.filter(isOpen);
  const overdue = open.filter((r) => dueOf(r) && dueOf(r) < todayStr).length;
  const soon = open.filter((r) => dueOf(r) && dueOf(r) >= todayStr && dueOf(r) <= soonStr).length;
  const asap = open.filter((r) => !dueOf(r)).length;
  log('Open tasks (New, In Progress, On Hold)');
  log(`  total                ${open.length}`);
  log(`  overdue              ${overdue}`);
  log(`  due today to +2 days ${soon}`);
  log(`  ASAP (no due date)   ${asap}`);
  log(`  due later            ${open.length - overdue - soon - asap}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  log(`MatterFlow demo data seeder${opts.dryRun ? ' (dry run: nothing is created)' : ''}`);
  log(`API ${opts.api} as ${opts.admin}, seed ${opts.seed}, run tag ${opts.tag}`);

  const stats = { retries429: 0, retriesTransient: 0, calls: 0 };
  const admin = new Api(opts.api, opts.admin, new Pacer(), { dryRun: opts.dryRun, stats });

  step('Checking the API');
  let ctx;
  try {
    ctx = await discover(admin);
  } catch (error) {
    if (
      error?.cause?.code === 'ECONNREFUSED' ||
      error?.cause?.code === 'ENOTFOUND' ||
      error?.name === 'TypeError'
    ) {
      fail(
        `Cannot reach the API at ${opts.api} (${error.cause?.code ?? error.message}). Start the app first ("npm start", API on http://localhost:5080) or pass --api.`,
      );
    }
    throw error;
  }
  log(
    `Signed in as ${ctx.me.displayName} (${ctx.me.roles.join(', ')}). ${ctx.taskTypes.length} task types, ${ctx.priorities.length} priorities, ${ctx.pods.length} pods.`,
  );

  const summary = {};
  step('Pods');
  await ensurePods(admin, ctx, opts, summary);
  step('Test users');
  await ensureUsers(admin, ctx, opts, summary);
  step('Demo clients, matters, projects and assets');
  await ensureOrganization(admin, ctx, opts, summary);
  step('Project managers');
  await ensureManagers(admin, ctx, opts, summary);
  step('Personas: a Project Manager with one matter and one with three');
  await ensurePersonas(admin, ctx, opts, summary);
  step('PM v2: task type colours and targets, asset sizes and dispositions');
  await ensurePmV2(admin, ctx, opts, summary);
  await ensureDemoTargets(admin, ctx, opts, summary);

  step('Tasks');
  const matterIds = ctx.matters.map((m) => m.matterId).filter((id) => id !== null);
  let existingDemoTasks = 0;
  for (const id of matterIds)
    existingDemoTasks += (await admin.get(`/api/v1/tasks?matterId=${id}&pageSize=1`)).total;
  let taskCount = opts.tasks;
  if (existingDemoTasks > 0 && !opts.tasksGiven) {
    log(
      `The Demo matters already hold ${existingDemoTasks} tasks, so no tasks are added. Pass --tasks N to add another batch of N tasks.`,
    );
    taskCount = 0;
  }
  if (ctx.users.length === 0 && taskCount > 0) {
    log('No test users (--users 0): tasks are created without assignees only.');
  }
  ctx.assignees = [
    ...ctx.users,
    {
      i: 0,
      account: admin.user,
      displayName: ctx.me.displayName,
      userId: ctx.me.userId,
      podIds: [],
    },
  ];
  const rng = createRng(opts.seed);
  const plans = taskCount > 0 && ctx.users.length > 0 ? planTasks(taskCount, ctx, opts, rng) : [];
  if (taskCount > 0 && plans.length === 0) fail('Tasks need at least one test user (--users).');

  let created = [];
  if (opts.dryRun) {
    summarize(
      plans.map((plan) => ({ plan, task: null })),
      ctx,
      'Planned',
    );
  } else if (plans.length > 0) {
    // Titles continue after the tasks of the type that exist already (earlier runs).
    const offsets = new Map();
    for (const type of ctx.taskTypes)
      offsets.set(
        type.id,
        (await admin.get(`/api/v1/tasks?taskTypeId=${type.id}&pageSize=1`)).total,
      );
    const userIds = ctx.users.map((u) => u.userId);
    const filler = new FormFiller(admin, createRng(opts.seed ^ 0x1f1f), {
      assetIdsFor: (matterId) => (ctx.assetPool.get(matterId) ?? []).map((a) => a.assetId),
      userIds,
    });
    const env = { admin, ctx, filler, offsets, opts };
    const failures = [];
    const leftovers = [];
    let done = 0;
    await pool(plans, opts.concurrency, async (plan) => {
      try {
        const partial = {};
        try {
          const task = await runTask(plan, env, partial);
          created.push({ plan, task });
        } catch (error) {
          if (partial.task) leftovers.push(partial.task.taskNumber);
          throw error;
        }
      } catch (error) {
        failures.push({ plan, error });
        log(
          `  ! task ${plan.k + 1} (${plan.type.name}, ${plan.state}) failed: ${error.message.slice(0, 300)}`,
        );
      }
      done++;
      if (done % 20 === 0 || done === plans.length)
        log(`  tasks ${done}/${plans.length} (${Math.round((Date.now() - startedAt) / 1000)} s)`);
    });
    created.sort((a, b) => a.plan.k - b.plan.k);
    summarize(created, ctx, 'Created');
    if (failures.length > 0)
      log(
        `\n${failures.length} of ${plans.length} tasks failed (see the messages above); run again with --tasks ${failures.length} to add replacements.`,
      );

    const found = await admin.get(
      `/api/v1/tasks?q=${encodeURIComponent(`[demo ${opts.tag}]`)}&pageSize=1`,
    );
    log(
      `\nVerification through the API: ${found.total} tasks carry the run tag "[demo ${opts.tag}]" in the requestor name (finished: ${created.length}).`,
    );
    if (leftovers.length > 0)
      log(
        `Tasks created but not finished because of the errors above: ${leftovers.join(', ')} (cancel them in the Task Queue if unwanted).`,
      );
    if (found.total !== created.length + leftovers.length) process.exitCode = 1;
    if (failures.length > 0) process.exitCode = 1;
  }

  step('Tasks for the one-matter and the three-matter Project Manager');
  await ensurePersonaTasks(admin, ctx, opts, summary);

  if (opts.aged) {
    step('Aged dates (--aged): At risk tasks and tasks On hold for days');
    if (opts.dryRun) log('Dry run: not changed.');
    else {
      assertLocal(opts.api);
      const moved = await ageDemoTasks(sqlFromOptions(opts));
      log(`${moved.atRisk} tasks moved back to At risk, ${moved.onHold} On hold tasks given an earlier start.`);
    }
  }

  step('Sensitive matters');
  if (opts.dryRun) log('Dry run: not read.');
  else await reportSensitive(admin, ctx);

  step('Done');
  log(
    `Users created ${summary.usersCreated ?? 0} (${summary.usersExisting ?? 0} existed, ${summary.usersFinished ?? 0} finished), pods created ${summary.podsCreated ?? 0}, clients ${summary.clientsCreated}, ` +
      `matters ${summary.mattersCreated}, projects ${summary.projectsCreated}, assets ${summary.assetsCreated}, tasks ${created.length}.`,
  );
  log(
    `${stats.calls} API calls, ${stats.retries429} rate limit retries, ${stats.retriesTransient} retries after a database conflict, ${Math.round((Date.now() - startedAt) / 1000)} s.`,
  );
  if (!opts.dryRun && created.length > 0)
    log(
      `Find this run's tasks: Task Queue search "demo ${opts.tag}" (requestor name). Reset everything: npm run db:reset.`,
    );
}

main().catch((error) => {
  console.error(`\nSeeding stopped: ${error?.message ?? error}`);
  if (error instanceof ApiError && error.status === 429)
    console.error('The API rate limit was hit repeatedly; run again in a minute.');
  process.exit(1);
});
