const STYLE_ID = 'qpm-pact-styles';
const CSS = `
.qpm-pact { display:flex; flex-direction:column; min-height:0; flex:1; gap:8px; padding:8px 12px 12px; }
.qpm-pact__toolbar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.qpm-pact__toolbar-right { margin-left:auto; display:flex; align-items:center; gap:6px; }
.qpm-pact__list { flex:1; min-height:0; position:relative; overflow:hidden; }
.qpm-pact__day { font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--qpm-text-muted); padding:6px 4px 4px; }
/* Pet column = squares(8)+gaps(12)+sprite+widest STR chip ("STR: 100/100" ≈74px); narrower and the
   global .qpm-window div{min-width:0} lets the squares column shrink into ovals. */
.qpm-pact__row { display:grid; grid-template-columns:138px 1fr auto 62px; align-items:center; gap:12px; padding:8px 10px; border-radius:8px; background:var(--qpm-surface-2); margin-bottom:4px; transition:background .15s ease; }
.qpm-pact__row:hover { background:var(--qpm-surface-3); }
.qpm-pact__row--compact { grid-template-columns:126px 1fr auto 62px; padding:4px 8px; gap:8px; }
.qpm-pact__row--expanded { background:var(--qpm-accent-subtle); }
.qpm-pact__row--expanded:hover { background:var(--qpm-accent-focus); }
.qpm-pact__row--sub { margin-left:28px; background:var(--qpm-surface-1); }
.qpm-pact__row--sub:hover { background:var(--qpm-surface-2); }
.qpm-pact__row--sub .qpm-pact__spr { width:36px; height:36px; }
.qpm-pact__row--group { cursor:pointer; }
.qpm-pact__arch .qpm-pact__c { width:34px; height:34px; display:flex; align-items:center; justify-content:center; }
.qpm-pact__arch .qpm-pact__c + .qpm-pact__c { margin-left:-16px; }
.qpm-pact__row--compact .qpm-pact__arch .qpm-pact__c + .qpm-pact__c { margin-left:-12px; }
/* 72px wide so the middle sprite centres at x=36, matching squares(8)+gap(6)+half sprite(22) on single rows. */
.qpm-pact__team { display:flex; align-items:center; justify-content:center; width:72px; height:44px; }
.qpm-pact__team .qpm-pact__c:nth-child(1) { transform:translateY(2px) rotate(-10deg); }
.qpm-pact__team .qpm-pact__c:nth-child(2) { transform:translateY(-5px); z-index:1; }
.qpm-pact__team .qpm-pact__c:nth-child(3) { transform:translateY(2px) rotate(10deg); }
.qpm-pact__str--inline { margin-left:8px; vertical-align:middle; }
.qpm-pact__arch .qpm-pact__c:nth-child(1) { transform:translateY(4px) rotate(-10deg); }
.qpm-pact__arch .qpm-pact__c:nth-child(2) { transform:translateY(-3px); z-index:1; }
.qpm-pact__arch .qpm-pact__c:nth-child(3) { transform:translateY(4px) rotate(10deg); }
.qpm-pact__arch .qpm-pact__c img { max-width:100%; max-height:100%; }
.qpm-pact__row--compact .qpm-pact__team { width:80px; height:32px; }
.qpm-pact__row--compact .qpm-pact__arch .qpm-pact__c { width:26px; height:26px; }
.qpm-pact__row--new { animation:qpm-pact-in .15s ease-out; }
@keyframes qpm-pact-in { from { opacity:0; } to { opacity:1; } }
.qpm-pact__pet { display:flex; align-items:center; gap:6px; min-width:0; }
.qpm-pact__squares { display:flex; flex-direction:column; gap:2px; flex-shrink:0; }
.qpm-pact__squares > div { flex-shrink:0; }
.qpm-pact__spr { width:44px; height:44px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.qpm-pact__row--compact .qpm-pact__spr { width:32px; height:32px; }
.qpm-pact__spr img { display:block; object-fit:contain; }
.qpm-pact__str { font-size:10px; font-weight:600; padding:1px 6px; border-radius:4px; background:var(--qpm-accent-subtle); color:var(--qpm-text); white-space:nowrap; font-variant-numeric:tabular-nums; }
.qpm-pact__txt { min-width:0; }
.qpm-pact__sent { font-size:12px; line-height:1.35; color:var(--qpm-text); }
.qpm-pact__sent b { font-weight:600; color:var(--qpm-gold); }
.qpm-pact__sent .qpm-pact__coin { color:var(--qpm-gold); font-weight:600; display:inline-flex; align-items:center; gap:3px; }
.qpm-pact__sent .qpm-pact__coin img { width:12px; height:12px; }
.qpm-pact__xn { font-size:10px; font-weight:700; padding:1px 7px; border-radius:9999px; background:var(--qpm-accent-tint); color:var(--qpm-gold); border:1px solid var(--qpm-accent-border); margin-left:6px; cursor:pointer; }
.qpm-pact__meta { font-size:10px; color:var(--qpm-text-muted); margin-top:2px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.qpm-pact__row--compact .qpm-pact__meta { display:none; }
.qpm-pact__fam { display:inline-flex; align-items:center; gap:4px; }
.qpm-pact__fam i, .qpm-pact__fam-dot { width:7px; height:7px; border-radius:2px; display:inline-block; }
.qpm-pact__fam-dot { margin-right:4px; }
.qpm-pact__tgt { display:flex; align-items:flex-end; justify-content:flex-end; gap:2px; min-width:70px; }
.qpm-pact__tgt .qpm-pact__c { width:30px; height:30px; display:flex; align-items:center; justify-content:center; }
.qpm-pact__row--compact .qpm-pact__tgt .qpm-pact__c { width:24px; height:24px; }
.qpm-pact__tgt .qpm-pact__c img { max-width:100%; max-height:100%; }
.qpm-pact__tgt--arch .qpm-pact__c + .qpm-pact__c { margin-left:-8px; }
.qpm-pact__tgt--arch .qpm-pact__c:nth-child(1) { transform:translateY(4px) rotate(-10deg); }
.qpm-pact__tgt--arch .qpm-pact__c:nth-child(2) { transform:translateY(-2px); z-index:1; }
.qpm-pact__tgt--arch .qpm-pact__c:nth-child(3) { transform:translateY(4px) rotate(10deg); }
.qpm-pact__more { font-size:10px; font-weight:700; width:22px; height:22px; border-radius:9999px; background:var(--qpm-surface-3); display:flex; align-items:center; justify-content:center; margin-left:4px; }
.qpm-pact__time { font-size:10px; color:var(--qpm-text-muted); text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.qpm-pact__newpill { position:absolute; top:6px; left:50%; transform:translateX(-50%); z-index:2; font-size:10px; font-weight:600; padding:4px 12px; border-radius:9999px; background:var(--qpm-accent); color:var(--qpm-text); border:none; cursor:pointer; }
.qpm-pact__dd { position:relative; }
.qpm-pact__dd-btn { display:inline-flex; align-items:center; gap:6px; height:26px; max-width:220px; padding:0 8px 0 6px; border-radius:9999px; border:1px solid var(--qpm-accent-border); background:var(--qpm-accent-tint); color:var(--qpm-text); font-size:12px; font-family:var(--qpm-font); cursor:pointer; transition:background .15s ease, border-color .15s ease; }
.qpm-pact__dd-btn:hover, .qpm-pact__dd-btn[aria-expanded="true"] { background:var(--qpm-accent-subtle); border-color:var(--qpm-accent-focus); }
.qpm-pact__dd-icon { width:20px; height:20px; object-fit:contain; }
.qpm-pact__dd-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.qpm-pact__dd-caret { font-size:10px; color:var(--qpm-text-muted); }
.qpm-pact .qpm-pact__dd-menu { position:absolute; top:calc(100% + 4px); right:0; z-index:5; width:280px; max-width:none; box-sizing:border-box; max-height:260px; overflow-y:auto; overflow-x:hidden; padding:4px; border-radius:8px; background:var(--qpm-surface-window); border:1px solid var(--qpm-accent-border); box-shadow:var(--qpm-shadow-subtle); }
.qpm-pact__dd-item { display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px; border:none; border-radius:4px; background:transparent; color:var(--qpm-text); font-size:12px; font-family:var(--qpm-font); text-align:left; cursor:pointer; transition:background .15s ease; }
.qpm-pact__dd-item:hover { background:var(--qpm-surface-3); }
.qpm-pact__dd-item--active { background:var(--qpm-accent-subtle); }
.qpm-pact__dd-item img { width:24px; height:24px; object-fit:contain; flex-shrink:0; }
.qpm-pact__dd-item .qpm-pact__dd-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.qpm-pact__dd-item .qpm-pact__dd-count { font-size:10px; color:var(--qpm-text-muted); font-variant-numeric:tabular-nums; }
`;
export function ensureActivityStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style'); el.id = STYLE_ID; el.textContent = CSS; doc.head.appendChild(el);
}
