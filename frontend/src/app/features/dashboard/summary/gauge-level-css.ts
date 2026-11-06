/**
 * The colour kinds of the Unassigned Wait level chip, shared by the full gauge and the compact gauge on the cards row (#1233): All clear (teal), Normal (slate), Level 1 and 2 (amber),
 * Level 3 (orange), Level 4 and 5 (red). A rule sets `--lbg`, `--lfg` and `--lbd`; the chip's own rules read them. The icon and the words carry the level, so colour is never the only signal.
 */
export const GAUGE_LEVEL_CSS = `
  .Lc {
    --lbg: var(--mf-p-teal-bg);
    --lfg: var(--mf-p-teal-fg);
    --lbd: var(--mf-p-teal-line);
  }
  .L0 {
    --lbg: var(--mf-p-slate-bg);
    --lfg: var(--mf-p-slate-fg);
    --lbd: var(--mf-p-slate-line);
  }
  .L1 {
    --lbg: var(--mf-p-amber-bg);
    --lfg: var(--mf-p-amber-fg);
    --lbd: var(--mf-p-amber-line);
  }
  .L2 {
    --lbg: var(--mf-p-amber-bg);
    --lfg: var(--mf-p-amber-fg);
    --lbd: var(--mf-p-amber-solid);
  }
  .L3 {
    --lbg: var(--mf-p-orange-bg);
    --lfg: var(--mf-p-orange-fg);
    --lbd: var(--mf-p-orange-solid);
  }
  .L4 {
    --lbg: var(--mf-p-red-bg);
    --lfg: var(--mf-p-red-fg);
    --lbd: var(--mf-p-red-solid);
  }
  .L5 {
    --lbg: var(--mf-p-red-fg);
    --lfg: var(--mf-white);
    --lbd: var(--mf-tag-red-fg);
  }
`;
