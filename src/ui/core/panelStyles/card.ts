export const CARD_CSS = `.qpm-card {
    background: var(--qpm-surface-2);
    border: 1px solid var(--qpm-border);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .qpm-table {
    width: 100%;
    border-collapse: collapse;
  }

  .qpm-table thead {
    background: var(--qpm-surface-3);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-size: var(--qpm-font-caption);
    font-weight: var(--qpm-weight-semibold);
    color: var(--qpm-text-muted);
  }

  .qpm-table th,
  .qpm-table td {
    padding: var(--qpm-space-3) var(--qpm-space-4);
    text-align: left;
    font-size: var(--qpm-font-body);
    border-bottom: 1px solid var(--qpm-border);
  }

  .qpm-table tbody tr:hover {
    background: var(--qpm-accent-tint);
  }

  .qpm-table tbody tr:nth-child(odd) {
    background: rgba(255, 255, 255, 0.02);
  }

  .qpm-table--compact th,
  .qpm-table--compact td {
    font-size: 10px;
  }

  .qpm-ability-divider td {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .qpm-ability-section td {
    background: rgba(255, 255, 255, 0.04);
    font-weight: 600;
    font-size: 11px;
    color: var(--qpm-text);
    padding: 7px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .qpm-ability-section__content {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .qpm-ability-section__title {
    font-weight: 600;
  }

  .qpm-ability-section__meta {
    font-weight: 400;
    font-size: 10px;
    color: var(--qpm-text-muted);
  }

  .qpm-ability-total {
    font-weight: 600;
    background: rgba(255, 255, 255, 0.03);
  }

  .qpm-ability-total td {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .qpm-tracker-summary {
    font-size: 11px;
    color: var(--qpm-text-muted);
    line-height: 1.5;
  }

  .qpm-mutation-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
  }

  .qpm-mutation-meta__group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .qpm-mutation-source {
    font-size: 10px;
    color: var(--qpm-text-muted);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .qpm-mutation-countdown {
    font-size: 11px;
    color: var(--qpm-text-muted);
    margin-top: 4px;
  }

  .qpm-mutation-countdown[data-state='active'] {
    color: #b3ffe0;
  }

  .qpm-mutation-countdown[data-state='expired'] {
    color: #ffcc80;
  }

  .qpm-mutation-totals {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .qpm-mutation-chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 6px 10px;
    min-width: 130px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .qpm-mutation-chip--active {
    border-color: rgba(143, 130, 255, 0.5);
    box-shadow: 0 0 0 1px rgba(143, 130, 255, 0.3);
  }

  .qpm-mutation-chip__label {
    font-size: 11px;
    font-weight: 600;
    color: var(--qpm-text);
  }

  .qpm-mutation-chip__meta {
    font-size: 10px;
    color: var(--qpm-text-muted);
  }

  .qpm-mutation-detail {
    margin-top: 8px;
  }

  .qpm-tracker-note {
    font-size: 10px;
    color: #90caf9;
    background: rgba(144, 202, 249, 0.08);
    border: 1px dashed rgba(144, 202, 249, 0.4);
    border-radius: 8px;
    padding: 8px;
  }

  .qpm-card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .qpm-card__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--qpm-text);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .qpm-section-muted {
    color: var(--qpm-text-muted);
    font-size: 11px;
  }`;
