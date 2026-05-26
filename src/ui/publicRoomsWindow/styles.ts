export const PR_STYLES = `
  .hidden { display: none !important; }
  #pr-app { color: #e5e7eb; font-family: var(--qpm-font); padding: 16px; }
  .pr-hero { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; padding: 18px; border-radius: 14px; background: linear-gradient(135deg, #0b1f2b, #0f2f3c 50%, #0b1b27); border: 1px solid rgba(100, 181, 246, 0.25); box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
  .pr-hero h3 { margin: 6px 0; font-size: 24px; color: #f8fafc; letter-spacing: 0.2px; }
  .pr-hero p { margin: 0; color: #94a3b8; font-size: 12px; }
  .pr-hero-badges { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .pr-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.1px; border: 1px solid transparent; }
  .pr-badge-ghost { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.08); color: #cbd5e1; }
  .pr-badge-status { background: rgba(100, 181, 246, 0.12); border-color: rgba(100, 181, 246, 0.4); color: #90caf9; }
  .pr-status-connecting { background: rgba(100, 181, 246, 0.12); color: #90caf9; border-color: rgba(100, 181, 246, 0.4); }
  .pr-status-connected { background: rgba(76, 175, 80, 0.12); color: #a5d6a7; border-color: rgba(76, 175, 80, 0.45); }
  .pr-status-failed { background: rgba(229, 57, 53, 0.12); color: #ef9a9a; border-color: rgba(229, 57, 53, 0.45); }
  .pr-status-retrying { background: rgba(255, 152, 0, 0.14); color: #ffcc80; border-color: rgba(255, 152, 0, 0.5); }
  .pr-controls { margin-top: 16px; padding: 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .pr-control { display: flex; flex-direction: column; gap: 6px; }
  .pr-control label { font-size: 12px; color: #cbd5e1; letter-spacing: 0.2px; font-weight: 600; }
  .pr-control input, .pr-control select { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.35); background: rgba(15, 23, 42, 0.6); color: #e2e8f0; font-size: 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
  .pr-control input:focus, .pr-control select:focus { outline: 2px solid rgba(100, 181, 246, 0.4); border-color: rgba(100, 181, 246, 0.6); }
  .pr-hint-line { margin: 6px 0 0; color: #9ca3af; font-size: 12px; letter-spacing: 0.1px; }
  .pr-stats { margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .pr-stat { padding: 12px 14px; border-radius: 12px; background: linear-gradient(135deg, rgba(148, 163, 184, 0.08), rgba(30, 41, 59, 0.6)); border: 1px solid rgba(148, 163, 184, 0.25); box-shadow: 0 6px 18px rgba(0,0,0,0.25); }
  .pr-stat-label { font-size: 12px; color: #94a3b8; letter-spacing: 0.2px; margin-bottom: 6px; }
  .pr-stat-value { font-size: 14px; font-weight: 700; color: #e2e8f0; }
  .pr-grid { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .pr-room-card { padding: 16px; border-radius: 14px; background: linear-gradient(145deg, rgba(255,255,255,0.04), rgba(15,23,42,0.7)); border: 1px solid rgba(148, 163, 184, 0.16); box-shadow: 0 10px 24px rgba(0,0,0,0.32); transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease; }
  .pr-room-card:hover { transform: translateY(-3px); border-color: rgba(100, 181, 246, 0.5); box-shadow: 0 14px 28px rgba(0,0,0,0.42); }
  .pr-room-header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .pr-room-title { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 18px; font-weight: 700; color: #f8fafc; }
  .pr-room-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .pr-player-count { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 12px; font-weight: 700; font-size: 12px; border: 1px solid rgba(255,255,255,0.08); }
  .pr-player-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .pr-players-empty { color: #94a3b8; font-size: 12px; margin-top: 10px; }
  .pr-room-actions { display: flex; gap: 8px; margin-top: 14px; }
  .pr-pill { padding: 6px 10px; border-radius: 10px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
  .pr-pill-private { background: rgba(229, 115, 115, 0.12); border: 1px solid rgba(229, 115, 115, 0.35); color: #ef9a9a; }
  .pr-pill-public { background: rgba(129, 199, 132, 0.12); border: 1px solid rgba(129, 199, 132, 0.35); color: #c8e6c9; }
  .pr-meta-line { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; color: #94a3b8; font-size: 12px; margin-top: 10px; }
  .pr-dot { width: 6px; height: 6px; border-radius: 50%; background: #4dd0e1; display: inline-block; }
  .pr-avatar-stack { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .pr-avatar { width: 28px; height: 28px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); display: grid; place-items: center; color: #cbd5e1; font-weight: 700; font-size: 12px; overflow: hidden; transition: transform 0.15s ease, box-shadow 0.15s ease; cursor: pointer; }
  .pr-avatar img { width: 100%; height: 100%; object-fit: cover; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
  .pr-inspector { position: fixed; inset: 0; z-index: 10000; }
  .pr-inspector.hidden { display: none; }
  .pr-inspector-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.85); }
  .pr-inspector-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(1000px, 96vw); max-height: 92vh; overflow: hidden; border-radius: 20px; background: linear-gradient(135deg, #0a1628 0%, #0f172a 30%, #1e1b4b 100%); border: 2px solid rgba(100,181,246,0.4); box-shadow: 0 25px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(100,181,246,0.2), inset 0 1px 0 rgba(255,255,255,0.1); display: flex; flex-direction: column; transition: left 0.2s ease, top 0.2s ease; }
  .pr-inspector-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; background: linear-gradient(135deg, rgba(100,181,246,0.15) 0%, rgba(139,92,246,0.1) 100%); border-bottom: 1px solid rgba(100,181,246,0.3); cursor: move; position: relative; overflow: hidden; }
  .pr-inspector-header:active { cursor: grabbing; }
  .pr-drag-indicator { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 22px; color: rgba(255,255,255,0.25); pointer-events: none; letter-spacing: -4px; font-weight: 700; }
  .pr-inspector-identity { display: flex; align-items: center; gap: 12px; }
  .pr-inspector-avatar { width: 42px; height: 42px; border-radius: 12px; background: rgba(255,255,255,0.06); display: grid; place-items: center; color: #e2e8f0; font-weight: 700; font-size: 14px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,0.08); }
  .pr-inspector-avatar.has-img { color: transparent; }
  .pr-inspector-name { font-size: 18px; font-weight: 700; color: #f8fafc; }
  .pr-inspector-sub { font-size: 12px; color: #9ca3af; }
  .pr-inspector-actions { display: flex; gap: 8px; position: relative; z-index: 10; }
  .pr-inspector-actions button { padding: 10px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid rgba(255,255,255,0.1); }
  .pr-inspector-actions button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  .pr-inspector-actions button:active { transform: translateY(0); }
  #pr-inspector-refresh { background: linear-gradient(135deg, rgba(100,181,246,0.2), rgba(139,92,246,0.15)); border-color: rgba(100,181,246,0.4); color: #7dd3fc; }
  #pr-inspector-refresh:hover { background: linear-gradient(135deg, rgba(100,181,246,0.3), rgba(139,92,246,0.25)); box-shadow: 0 4px 16px rgba(100,181,246,0.4); }
  #pr-inspector-close { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #fca5a5; }
  #pr-inspector-close:hover { background: rgba(239,68,68,0.25); box-shadow: 0 4px 16px rgba(239,68,68,0.3); }
  .pr-inspector-tabs { display: flex; gap: 6px; padding: 12px 16px; background: linear-gradient(135deg, rgba(15,23,42,0.8) 0%, rgba(30,27,75,0.6) 100%); border-bottom: 1px solid rgba(100,181,246,0.2); }
  .pr-inspector-tab { padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #e2e8f0; font-weight: 700; font-size: 14px; cursor: pointer; position: relative; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .pr-inspector-tab:hover { background: rgba(100,181,246,0.1); color: #e0e7ff; transform: translateY(-2px); border-color: rgba(100,181,246,0.3); }
  .pr-inspector-tab.active { background: linear-gradient(135deg, rgba(100,181,246,0.25), rgba(139,92,246,0.2)); border-color: rgba(100,181,246,0.5); color: #7dd3fc; box-shadow: 0 4px 12px rgba(100,181,246,0.3), inset 0 1px 0 rgba(255,255,255,0.1); }
  .pr-inspector-tab.active::after { content: ''; position: absolute; bottom: -1px; left: 50%; transform: translateX(-50%); width: 60%; height: 3px; background: linear-gradient(90deg, transparent, #38bdf8, transparent); border-radius: 999px; }
  .pr-inspector-body { padding: 12px; overflow: auto; flex: 1; display: grid; }
  .pr-inspector-pane { display: none; gap: 10px; }
  .pr-inspector-pane.active { display: grid; gap: 10px; }
  .pr-pane-card { border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); padding: 12px; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
  .pr-pane-card:hover { border-color: rgba(100,181,246,0.15); background: rgba(255,255,255,0.05); box-shadow: 0 4px 16px rgba(100,181,246,0.1); }
  .pr-pane-title { font-weight: 700; margin-bottom: 6px; color: #f8fafc; font-size: 14px; }
  .pr-pane-placeholder { color: #9ca3af; font-size: 12px; }
  .pr-overview { display: flex; flex-direction: column; gap: 12px; color: #e2e8f0; }
  .pr-avatar-block { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 12px; background: linear-gradient(135deg, rgba(100,181,246,0.05), rgba(139,92,246,0.03)); border: 1px solid rgba(100,181,246,0.15); transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
  .pr-avatar-block:hover { background: linear-gradient(135deg, rgba(100,181,246,0.08), rgba(139,92,246,0.05)); border-color: rgba(100,181,246,0.25); box-shadow: 0 4px 12px rgba(100,181,246,0.15); }
  .pr-avatar-block-img { width: 50px; height: 50px; border-radius: 12px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,0.08); }
  .pr-avatar-block-fallback { width: 50px; height: 50px; border-radius: 12px; display: grid; place-items: center; font-weight: 700; color: #cbd5e1; background: rgba(148,163,184,0.12); border: 1px solid rgba(255,255,255,0.08); }
  .pr-avatar-name { font-weight: 700; color: #f8fafc; }
  .pr-avatar-id { font-size: 12px; color: #94a3b8; }
  .pr-overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
  .pr-row { display: flex; justify-content: space-between; gap: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); font-size: 12px; }
  .pr-row span:first-child { color: #94a3b8; }
  .pr-hint { color: #94a3af; font-size: 12px; }
  .pr-section { display: flex; flex-direction: column; gap: 12px; }
  .pr-section-head { font-weight: 700; color: #f8fafc; letter-spacing: 0.2px; display: flex; align-items: center; gap: 8px; }
  .pr-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .pr-garden-plots { display: flex; gap: 20px; justify-content: center; align-items: flex-start; flex-wrap: wrap; }
  .pr-garden-plot { display: flex; flex-direction: column; gap: 8px; }
  .pr-garden-plot-label { font-weight: 700; color: #94a3b8; font-size: 12px; text-align: center; letter-spacing: 0.5px; }
  .pr-garden-grid-10x10 { display: grid; grid-template-columns: repeat(10, 32px); grid-template-rows: repeat(10, 32px); gap: 2px; padding: 12px; background: rgba(15,23,42,0.5); border-radius: 8px; justify-content: center; max-width: fit-content; }
  .pr-garden-tile { width: 32px; height: 32px; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; background: rgba(34,40,49,0.6); display: flex; align-items: center; justify-content: center; position: relative; cursor: help; transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .pr-garden-tile:hover { transform: scale(1.15); box-shadow: 0 4px 12px rgba(56,189,248,0.4); z-index: 10; }
  .pr-garden-tile-empty { background: rgba(20,25,32,0.4); border-color: rgba(255,255,255,0.05); }
  .pr-garden-tile-egg { border-color: rgba(255,179,0,0.3); }
  .pr-garden-sprite { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
  .pr-garden-placeholder { font-size: 16px; opacity: 0.3; }
  .pr-multi-icon { position: absolute; top: 0; right: 0; background: rgba(124,58,237,0.9); color: #fff; font-size: 9px; font-weight: 700; padding: 1px 3px; border-radius: 0 3px 0 4px; line-height: 1; }
  .pr-boardwalk-section { display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .pr-boardwalk-grid-23x12 { display: grid; grid-template-columns: repeat(23, 20px); grid-template-rows: repeat(12, 20px); gap: 1px; padding: 8px; background: rgba(101, 67, 33, 0.2); border-radius: 8px; justify-content: center; border: 2px dashed rgba(139, 90, 43, 0.4); }
  .pr-boardwalk-tile { width: 20px; height: 20px; background: linear-gradient(135deg, #654321, #8B5A2B); border: 1px solid rgba(139, 90, 43, 0.6); border-radius: 3px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: help; transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .pr-boardwalk-tile:hover { transform: scale(1.15); box-shadow: 0 4px 12px rgba(139, 90, 43, 0.6); z-index: 10; }
  .pr-boardwalk-tile-empty { background: rgba(20,25,32,0.4); border-color: rgba(139, 90, 43, 0.2); }
  .pr-pet-str { color: #a78bfa; font-size: 12px; font-weight: 700; }
  .pr-journal-progress { display: flex; flex-direction: column; gap: 16px; }
  .pr-journal-item { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); transition: transform 0.2s ease, box-shadow 0.2s ease; }
  .pr-journal-item:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
  .pr-journal-header { display: flex; justify-content: space-between; font-size: 14px; color: #cbd5e1; font-weight: 600; }
  .pr-journal-count { font-weight: 700; color: #7dd3fc; font-size: 14px; }
  .pr-progress-pct { font-size: 12px; color: #94a3b8; text-align: right; margin-top: 4px; }
  .pr-progress-bar { height: 12px; border-radius: 999px; background: rgba(0,0,0,0.3); overflow: hidden; border: 1px solid rgba(255,255,255,0.15); position: relative; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3); }
  .pr-progress-fill { height: 100%; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); position: relative; }
  .pr-journal-tabs { display: flex; gap: 6px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .pr-journal-tab { padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #cbd5e1; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
  .pr-journal-tab:hover { background: rgba(100,181,246,0.1); color: #e0e7ff; border-color: rgba(100,181,246,0.3); }
  .pr-journal-tab.active { background: linear-gradient(135deg, rgba(100,181,246,0.25), rgba(139,92,246,0.2)); border-color: rgba(100,181,246,0.5); color: #7dd3fc; box-shadow: 0 2px 8px rgba(100,181,246,0.3); }
  .pr-journal-tab-content { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; max-height: 300px; overflow-y: auto; overflow-x: hidden; }
  .pr-journal-detail-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; background: transparent; border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s ease; min-width: 0; }
  .pr-journal-detail-row:hover { background: rgba(100,181,246,0.08); border-color: rgba(100,181,246,0.3); transform: translateX(2px); }
  .pr-journal-species { font-size: 12px; font-weight: 600; color: #e2e8f0; min-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .pr-journal-variants { font-size: 12px; color: #94a3b8; font-weight: 500; min-width: 120px; }
  .pr-progress-bar-mini { height: 8px; border-radius: 999px; background: rgba(0,0,0,0.3); overflow: hidden; border: 1px solid rgba(255,255,255,0.1); flex: 1; }
  .pr-progress-fill-mini { height: 100%; transition: width 0.4s ease; border-radius: 999px; }
  .pr-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .pr-stat-row { display: flex; justify-content: space-between; padding: 12px 14px; border-radius: 10px; background: linear-gradient(135deg, rgba(100,181,246,0.05), rgba(139,92,246,0.03)); border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s ease; }
  .pr-stat-row:hover { transform: translateX(4px); background: linear-gradient(135deg, rgba(100,181,246,0.1), rgba(139,92,246,0.05)); border-color: rgba(100,181,246,0.3); box-shadow: 0 4px 12px rgba(100,181,246,0.2); }
  .pr-stat-label { color: #cbd5e1; font-size: 12px; font-weight: 500; }
  .pr-stat-value { color: #7dd3fc; font-weight: 700; font-size: 14px; letter-spacing: 0.3px; }

  /* New vertical inventory cards - game style */
  .pr-inv-card { position: relative; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(20,25,35,0.85); box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: all 0.2s ease; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 100px; }
  .pr-inv-card:hover { transform: translateY(-3px); border-color: rgba(100,181,246,0.4); box-shadow: 0 6px 20px rgba(100,181,246,0.2); }
  .pr-inv-card.pet-card { background: rgba(30,20,45,0.9); border-color: rgba(168,139,250,0.2); position: relative; min-width: 130px; }
  .pr-inv-card.pet-card:hover { border-color: rgba(168,139,250,0.5); }
  .pr-inv-abilities { position: absolute; left: 12px; top: 48px; transform: translateY(-50%); display: flex; flex-direction: column; gap: 3px; z-index: 2; pointer-events: none; }
  .pr-inv-sprite-container { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; }
  .pr-inv-sprite { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
  .pr-inv-placeholder { font-size: 32px; opacity: 0.4; }
  .pr-inv-name { font-size: 12px; font-weight: 700; color: #e2e8f0; text-align: center; line-height: 1.2; max-width: 100%; word-wrap: break-word; }
  .pr-inv-qty { font-size: 12px; font-weight: 700; color: #7dd3fc; background: rgba(56,189,248,0.15); padding: 3px 8px; border-radius: 6px; }
  .pr-inv-str { font-size: 12px; font-weight: 700; color: #a78bfa; background: rgba(168,139,250,0.15); padding: 3px 8px; border-radius: 6px; }
  .pr-ability-square { width: 14px; height: 14px; border-radius: 3px; box-shadow: 0 1px 4px rgba(0,0,0,0.5); cursor: help; flex-shrink: 0; }
  .pr-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; justify-items: center; }
  .pr-badge-soft { padding: 6px 8px; border-radius: 10px; background: rgba(148,163,184,0.12); color: #cbd5e1; font-size: 12px; font-weight: 700; }
  .pr-sprite-circle { width: 42px; height: 42px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); display: grid; place-items: center; image-rendering: pixelated; background-size: contain; background-repeat: no-repeat; background-position: center; font-size: 18px; }
  .pr-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 12px; font-weight: 700; }
  .pr-mut-badges { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .pr-mut-badge { display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; }
  .pr-stack { display: flex; flex-direction: column; gap: 6px; }
  .pr-progress { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  .pr-progress-track { width: 100%; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
  .pr-progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #38bdf8); border-radius: 999px; }
  .pr-progress-label { font-size: 12px; color: #cbd5e1; }
  .pr-pill-qty { padding: 6px 10px; border-radius: 10px; background: rgba(56,189,248,0.16); color: #7dd3fc; font-weight: 700; font-size: 12px; }
  .pr-timeline { display: flex; flex-direction: column; gap: 10px; }
  .pr-timeline-item { display: grid; grid-template-columns: auto auto 1fr auto; gap: 10px; align-items: center; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(100,181,246,0.02)); transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
  .pr-timeline-item:hover { background: linear-gradient(135deg, rgba(100,181,246,0.08), rgba(139,92,246,0.05)); border-color: rgba(100,181,246,0.2); transform: translateX(4px); box-shadow: -4px 0 12px rgba(100,181,246,0.15); }
  .pr-timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg, #38bdf8, #a855f7); box-shadow: 0 0 8px rgba(56,189,248,0.7); }
  .pr-timeline-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .pr-timeline-title { font-weight: 700; color: #f8fafc; }
  .pr-timeline-detail { color: #cbd5e1; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pr-time-badge { padding: 6px 10px; border-radius: 999px; background: rgba(148,163,184,0.14); color: #cbd5e1; font-size: 12px; font-weight: 700; }
  .pr-inspector-footer { padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.05); color: #94a3b8; font-size: 12px; letter-spacing: 0.2px; }
  .pr-avatar:hover { transform: scale(1.14); box-shadow: 0 0 0 2px rgba(100,181,246,0.45); }

  /* Custom scrollbar styling */
  .pr-inspector-body::-webkit-scrollbar { width: 10px; }
  .pr-inspector-body::-webkit-scrollbar-track { background: rgba(15,23,42,0.5); border-radius: 10px; margin: 4px; }
  .pr-inspector-body::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(100,181,246,0.4), rgba(139,92,246,0.3)); border-radius: 10px; border: 2px solid rgba(15,23,42,0.5); }
  .pr-inspector-body::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(100,181,246,0.6), rgba(139,92,246,0.5)); }
`;
