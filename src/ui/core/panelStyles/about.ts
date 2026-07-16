export const ABOUT_CSS = `/* ── About window ── */
  @keyframes qpm-heart-pop {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.25); }
    100% { transform: scale(1); }
  }
  .qpm-about {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    text-align: center;
  }
  .qpm-about__title {
    font-size: var(--qpm-font-size-lg);
    font-weight: var(--qpm-font-weight-bold);
    color: var(--qpm-accent);
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .qpm-about__version {
    font-size: var(--qpm-font-size-sm);
    font-weight: var(--qpm-font-weight-normal);
    color: var(--qpm-text-muted);
  }
  .qpm-about__author {
    font-size: var(--qpm-font-size-sm);
    color: var(--qpm-text);
  }
  .qpm-about__sponsor-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .qpm-about__sponsor-text {
    font-size: var(--qpm-font-size-xs);
    color: var(--qpm-text-muted);
  }
  .qpm-about__sponsor-accent {
    color: var(--qpm-accent);
  }
  .qpm-about__heart-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--qpm-surface-2);
    border: 1px solid rgba(143, 130, 255, 0.22);
    border-radius: var(--qpm-radius-sm);
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }
  .qpm-about__heart-btn:hover {
    background: var(--qpm-surface-3);
  }
  .qpm-about__heart-btn svg {
    width: 16px;
    height: 16px;
    fill: #db61a2;
  }
  .qpm-about__heart-btn--pop {
    animation: qpm-heart-pop 250ms ease-out;
  }
  .qpm-about__kofi-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--qpm-surface-2);
    border: 1px solid rgba(143, 130, 255, 0.22);
    border-radius: var(--qpm-radius-sm);
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }
  .qpm-about__kofi-btn:hover {
    background: var(--qpm-surface-3);
  }
  .qpm-about__kofi-btn svg {
    width: 16px;
    height: 16px;
    fill: #ff5e5b;
  }
  .qpm-about__kofi-btn--pop {
    animation: qpm-heart-pop 250ms ease-out;
  }
  .qpm-about__tokyo-card {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 240px;
    height: 343px;
    padding: 0;
    border: 1px solid rgba(143, 130, 255, 0.32);
    border-radius: var(--qpm-radius-md);
    background: transparent;
    cursor: pointer;
    overflow: hidden;
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  }
  .qpm-about__tokyo-card:hover {
    transform: scale(1.04);
    border-color: var(--qpm-accent);
    box-shadow: 0 4px 16px rgba(143, 130, 255, 0.4);
  }
  .qpm-about__tokyo-card img,
  .qpm-about__tokyo-card video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }`;
