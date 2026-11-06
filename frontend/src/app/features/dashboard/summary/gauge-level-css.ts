/**
 * The colour kinds of the Unassigned Wait level chip, shared by the full gauge and the compact gauge on the cards row (#1233): All clear (teal), Normal (slate), Level 1 and 2 (amber),
 * Level 3 (orange), Level 4 and 5 (red). A rule sets `--lbg`, `--lfg` and `--lbd`; the chip's own rules read them. The icon and the words carry the level, so colour is never the only signal.
 */
export const GAUGE_LEVEL_CSS = `
  .Lc {
    --lbg: var(--mf-sem-healthy-bg);
    --lfg: var(--mf-sem-healthy-fg);
    --lbd: var(--mf-sem-healthy-line);
  }
  .L0 {
    --lbg: var(--mf-sem-neutral-bg);
    --lfg: var(--mf-sem-neutral-fg);
    --lbd: var(--mf-sem-neutral-line);
  }
  .L1 {
    --lbg: var(--mf-sem-risk-bg);
    --lfg: var(--mf-sem-risk-fg);
    --lbd: var(--mf-sem-risk-line);
  }
  .L2 {
    --lbg: var(--mf-sem-risk-bg);
    --lfg: var(--mf-sem-risk-fg);
    --lbd: var(--mf-sem-risk-solid);
  }
  .L3 {
    --lbg: var(--mf-sem-critical-bg);
    --lfg: var(--mf-sem-critical-fg);
    --lbd: var(--mf-sem-critical-solid);
  }
  .L4 {
    --lbg: var(--mf-sem-overdue-bg);
    --lfg: var(--mf-sem-overdue-fg);
    --lbd: var(--mf-sem-overdue-solid);
  }
  .L5 {
    --lbg: var(--mf-sem-overdue-fg);
    --lfg: var(--mf-white);
    --lbd: var(--mf-tag-red-fg);
  }
`;
