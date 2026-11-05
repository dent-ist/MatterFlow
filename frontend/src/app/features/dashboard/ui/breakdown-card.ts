/**
 * The card of a Breakdowns chart in the theme of the rest of the Dashboard (DB-11): rounded card, card shadow, a header with the Title Case name and the view
 * switch, a body that fills the card (and scrolls inside it when the list is long). Shared by the bar list and the age bar.
 */
export const BD_CARD_CSS = `
  :host {
    display: block;
    min-width: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    padding: var(--mf-s4);
    background: var(--mf-surface);
    border: 1px solid var(--mf-border-soft);
    border-radius: var(--mf-radius-xl);
    box-shadow: var(--mf-shadow-card);
    container-type: inline-size;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--mf-s3);
    margin-bottom: var(--mf-s3);
  }
  /* Title and switch stay on one row (#1219): the title gives way with an ellipsis, the switch never shrinks. */
  h3 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
    font-size: var(--mf-fs-xl, 1.25rem);
    font-weight: 700;
    line-height: 1.25;
  }
  .note,
  .empty {
    margin: 0 0 var(--mf-s3);
    color: var(--mf-text-muted);
    font-size: var(--mf-fs-sm);
  }
  /* A coloured tile for an icon (priority, status): the colours are the badge tokens, so the pair is already contrast checked. */
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    box-sizing: border-box;
    border: 1px solid var(--mf-border-soft);
    border-radius: var(--mf-radius-md);
    font-size: 0.875rem;
  }
  @media (forced-colors: active) {
    .tile {
      forced-color-adjust: none;
      background: Canvas !important;
      color: CanvasText !important;
      border-color: CanvasText;
    }
  }
`;
