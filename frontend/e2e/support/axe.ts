import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Page } from '@playwright/test';

/**
 * Runs axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa) in the page and returns the violations. The axe source comes from the
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

export async function axeViolations(page: Page, include?: string): Promise<AxeViolation[]> {
  cached ??= axeSource();
  if (cached === null) throw new Error('axe-core is not available');
  await page.evaluate(cached);
  return page.evaluate(
    async ({ include }) => {
      const axe = (
        window as unknown as {
          axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: AxeRaw[] }> };
        }
      ).axe;
      const result = await axe.run(include ? { include: [[include]] } : document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
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
    { include },
  );
}
