import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Page } from '@playwright/test';

/**
 * Runs axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa) in the page and returns the violations. `axeBestPractice(page)` adds the
 * `best-practice` tag (skip-link, region, landmark rules; #597): the shell guard uses it on every shell route and state, and other specs may
 * adopt it as their pages become clean. The axe source comes from the
 * `E2E_AXE_PATH` environment variable (path to `axe.min.js`) or from an installed `axe-core` package; `axeAvailable()` is false when
 * neither exists, and the accessibility tests skip themselves then.
 */
function axeSource(): string | null {
  const candidates: string[] = [];
  if (process.env['E2E_AXE_PATH']) candidates.push(process.env['E2E_AXE_PATH']);
  try {
    candidates.push(createRequire(__filename).resolve('axe-core/axe.min.js'));
  } catch {
    /* not installed */
  }
  for (const file of candidates) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return null;
}

let cached: string | null | undefined;

export function axeAvailable(): boolean {
  cached ??= axeSource();
  return cached !== null;
}

interface AxeCheck {
  message: string;
}

interface AxeRaw {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[]; html: string; any: AxeCheck[]; all: AxeCheck[]; none: AxeCheck[] }[];
}

export interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[]; html: string; why?: string }[];
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** WCAG 2.2 AA plus the best-practice rule set (#597). */
export function axeBestPractice(page: Page, include?: string): Promise<AxeViolation[]> {
  return axeViolations(page, include, [...WCAG_TAGS, 'best-practice']);
}

export async function axeViolations(
  page: Page,
  include?: string,
  tags: string[] = WCAG_TAGS,
): Promise<AxeViolation[]> {
  cached ??= axeSource();
  if (cached === null) throw new Error('axe-core is not available');
  // A toast or a badge that is still fading in is read half transparent (contrast 3.4 to 4.3 on text that is 4.5 or better at rest), and
  // a grid that is reloading dims its rows (`aria-busy`, 60 percent): let every finite animation and transition finish and the busy
  // grids settle first (at most 3 s; an endless animation, a spinner, does not count).
  await page
    .waitForFunction(
      () =>
        !document.querySelector('table[aria-busy="true"], ul[aria-busy="true"]') &&
        !document.getAnimations().some((a) => {
          const timing = a.effect?.getComputedTiming();
          return a.playState === 'running' && !!timing && timing.iterations !== Infinity;
        }),
      undefined,
      { timeout: 3000 },
    )
    .catch(() => undefined);
  await page.evaluate(cached);
  return page.evaluate(
    async ({ include, tags }) => {
      const axe = (
        window as unknown as {
          axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: AxeRaw[] }> };
        }
      ).axe;
      const result = await axe.run(include ? { include: [[include]] } : document, {
        runOnly: { type: 'tag', values: tags },
      });
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => ({
          target: n.target,
          html: n.html.slice(0, 160),
          why: [...n.any, ...n.all, ...n.none].map((c) => c.message).join(' | '),
        })),
      }));
    },
    { include, tags },
  );
}
