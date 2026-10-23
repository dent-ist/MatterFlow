import { Json } from './api';
import { Persona, Personas } from './personas';
import { Seeder, World, uid } from './seed';

/**
 * A small world of its own for the My Matters specs (epic #667): one Project Manager, one client, matters with exactly the managers and tasks a
 * test needs, so the numbers on the page can be written down instead of read back. (`pmFixtures` is the shared set of the Matters list specs; the
 * specs that change tasks use this one so they never disturb each other.) Everything goes through the published API.
 */
export interface MmMatter {
  matterId: number;
  matterRef: string;
  name: string;
}

export interface MmWorld {
  world: World;
  pm: Persona;
  /** Another Project Manager, to be Secondary on matters. */
  other: Persona;
  matter(name: string, primary?: Persona | null, secondary?: Persona | null): Promise<MmMatter>;
  task(matter: MmMatter, overrides?: Json): Promise<Json>;
}

/** `yyyy-mm-dd` of today plus `days` (UTC date arithmetic; the specs use gaps of several days so the viewer's zone never matters). */
export function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function mmWorld(seed: Seeder, personas: Personas, label: string): Promise<MmWorld> {
  const world = await seed.world();
  const token = uid().slice(0, 5);
  const pm = await personas.create({
    label: `${label}-pm`,
    roles: ['Project Manager'],
    displayName: `PM One ${label} ${token}`,
  });
  const other = await personas.create({
    label: `${label}-pm2`,
    roles: ['Project Manager'],
    displayName: `PM Two ${label} ${token}`,
  });
  let next = 1; // the world's own matter holds 00001
  return {
    world,
    pm,
    other,
    async matter(name, primary = pm, secondary = null) {
      const created = await seed.matter({
        client: world.client,
        number: String(++next).padStart(5, '0'),
        name: `${name} ${label}`,
      });
      if (primary || secondary) {
        await seed.admin.put(`/api/v1/matters/${created.matterId}/managers`, {
          primaryManagerId: primary?.userId ?? null,
          secondaryManagerId: secondary?.userId ?? null,
          rowVersion: created.rowVersion,
        });
      }
      return { matterId: created.matterId, matterRef: created.matterRef, name: created.name };
    },
    task(matter, overrides = {}) {
      return seed.task(
        {
          matter: { matterId: matter.matterId },
          taskType: world.taskType,
          workflow: world.workflow,
        },
        overrides,
      );
    },
  };
}
