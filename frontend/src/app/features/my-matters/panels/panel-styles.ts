/** The look the My Matters list panels share: rows with a link, a muted matter line and the fact on the right; 44 px targets below 640 px. */
export const PANEL_LIST_STYLES = `
  .pl__empty {
    margin: 0;
    padding: var(--mf-s2) 0;
    color: var(--mf-text-muted);
  }
  .pl__group + .pl__group {
    margin-top: var(--mf-s3);
  }
  .pl__sub {
    margin: 0 0 var(--mf-s1);
    font-size: var(--mf-fs-md);
    font-weight: 700;
  }
  .pl__n {
    font-weight: 400;
    color: var(--mf-text-muted);
  }
  .pl__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pl__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'link fact'
      'meta fact';
    column-gap: var(--mf-s3);
    padding: var(--mf-s1) 0;
    border-top: 1px solid var(--mf-border);
  }
  .pl__line {
    grid-area: link;
    display: flex;
    gap: var(--mf-s2);
    align-items: center;
    min-width: 0;
  }
  .pl__link {
    grid-area: link;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 24px;
    line-height: 24px;
    overflow: hidden;
    color: var(--mf-link);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pl__meta {
    grid-area: meta;
    min-width: 0;
    overflow: hidden;
    color: var(--mf-text-muted);
    font-size: var(--mf-fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pl__prio {
    display: inline-block;
    padding: 0 var(--mf-s2);
    border: 1px solid var(--mf-border);
    border-radius: var(--mf-radius);
    color: var(--mf-text);
    font-size: var(--mf-fs-xs);
    font-weight: 600;
    line-height: 1.5;
  }
  .pl__risk {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    padding: 0 var(--mf-s2);
    border: 1px solid var(--mf-warning-border, #b45309);
    border-radius: var(--mf-radius);
    background: var(--mf-warning-bg, #fef3c7);
    color: var(--mf-warning-text, #5c3b00);
    font-size: var(--mf-fs-xs);
    font-weight: 600;
    line-height: 1.5;
  }
  .pl__fact {
    grid-area: fact;
    align-self: center;
    color: var(--mf-text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pl__all {
    display: inline-block;
    margin-top: var(--mf-s1);
    padding: var(--mf-s1) 0;
    color: var(--mf-link);
  }
  @media (max-width: 639.98px) {
    .pl__row {
      min-height: 44px;
      align-content: center;
    }
    .pl__link {
      display: flex;
      align-items: center;
      min-height: 44px;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .pl__meta {
      padding-bottom: var(--mf-s1);
    }
    .pl__all {
      min-height: 44px;
      padding: 12px 0;
      box-sizing: border-box;
    }
  }
`;
