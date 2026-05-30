// CSS for the 3v3 team comparison panel (.qpm-tcmp-* classes).

export const COMPARE_STYLES = `
.qpm-tcmp-grid { display:flex; flex-direction:column; gap:10px; }
.qpm-tcmp-team-summary {
  display:flex;
  flex-direction:column;
  gap:7px;
  padding:10px 12px;
  border:1px solid rgba(143,130,255,0.24);
  border-radius:10px;
  background:linear-gradient(155deg, rgba(143,130,255,0.10), rgba(255,255,255,0.02));
}
.qpm-tcmp-team-head {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}
.qpm-tcmp-team-title {
  font-size:12px;
  color:rgba(224,224,224,0.8);
  font-weight:600;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.qpm-tcmp-team-score {
  font-size:12px;
  font-weight:700;
  color:#dfe6ff;
  text-align:left;
}
.qpm-tcmp-team-score--right { text-align:right; }
.qpm-tcmp-team-score--win { color:#74ffb5; }
.qpm-tcmp-team-score--lose { color:rgba(224,224,224,0.38); }
.qpm-tcmp-team-table {
  display:grid;
  grid-template-columns:minmax(0,1fr) 98px minmax(0,1fr);
  gap:6px;
  align-items:center;
}
.qpm-tcmp-team-table-head {
  font-size:10px;
  text-transform:uppercase;
  letter-spacing:0.08em;
  color:rgba(224,224,224,0.45);
  border-bottom:1px solid rgba(143,130,255,0.18);
  padding-bottom:3px;
}
.qpm-tcmp-team-table-head--a { text-align:left; }
.qpm-tcmp-team-table-head--mid { text-align:center; }
.qpm-tcmp-team-table-head--b { text-align:right; }
.qpm-tcmp-team-a { text-align:left; font-size:12px; font-weight:700; color:#e7e8ff; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.qpm-tcmp-team-b { text-align:right; font-size:12px; font-weight:700; color:#e7e8ff; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.qpm-tcmp-team-mid {
  text-align:center;
  font-size:10px;
  text-transform:uppercase;
  letter-spacing:0.07em;
  color:rgba(224,224,224,0.48);
  white-space:nowrap;
}
.qpm-tcmp-team-win { color:#74ffb5; }
.qpm-tcmp-row {
  display:grid;
  grid-template-columns:minmax(0,1fr) 236px minmax(0,1fr);
  gap:10px;
  align-items:stretch;
  padding:12px;
  border:1px solid rgba(143,130,255,0.22);
  border-radius:10px;
  background:linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
}
.qpm-tcmp-pet {
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  border:1px solid rgba(143,130,255,0.22);
  border-radius:9px;
  padding:10px 11px;
  background:rgba(8,10,18,0.42);
  transition:border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.qpm-tcmp-pet--right { align-items:flex-end; text-align:right; }
.qpm-tcmp-head { display:flex; align-items:center; gap:8px; min-width:0; min-height:50px; }
.qpm-tcmp-pet--right .qpm-tcmp-head { flex-direction:row-reverse; }
.qpm-tcmp-pet--winner {
  border-color:rgba(102,255,165,0.58);
  background:linear-gradient(170deg, rgba(64,255,194,0.14), rgba(8,10,18,0.45));
  box-shadow:0 0 0 1px rgba(102,255,165,0.25) inset;
}
.qpm-tcmp-pet--loser {
  opacity:0.88;
  border-color:rgba(143,130,255,0.15);
}
.qpm-tcmp-sprite {
  width:46px; height:46px;
  border-radius:8px;
  background:rgba(143,130,255,0.10);
  display:flex; align-items:center; justify-content:center;
  font-size:22px;
  overflow:hidden;
  flex-shrink:0;
}
.qpm-tcmp-sprite img { width:46px; height:46px; object-fit:contain; image-rendering:pixelated; }
.qpm-tcmp-name { font-size:14px; font-weight:700; color:#f0eeff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.qpm-tcmp-str { font-size:12px; color:rgba(224,224,224,0.72); font-family:monospace; }
.qpm-tcmp-idline {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:7px;
  width:100%;
}
.qpm-tcmp-idline--right { flex-direction:row-reverse; }
.qpm-tcmp-idcopy { min-width:0; flex:1; }
.qpm-tcmp-adots {
  display:flex;
  gap:4px;
  flex-wrap:wrap;
  max-width:72px;
  margin-top:2px;
}
.qpm-tcmp-adots--right { justify-content:flex-start; }
.qpm-tcmp-adot {
  width:9px;
  height:9px;
  border-radius:2px;
  box-shadow:0 0 0 1px rgba(255,255,255,0.2) inset;
  flex-shrink:0;
}
.qpm-tcmp-ab {
  display:flex;
  flex-direction:column;
  gap:2px;
  max-width:100%;
  min-height:30px;
}
.qpm-tcmp-ab-main {
  font-size:11px;
  color:rgba(170,200,255,0.86);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.qpm-tcmp-ab-all {
  font-size:10px;
  color:rgba(224,224,224,0.5);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.qpm-tcmp-metrics {
  display:flex;
  flex-direction:column;
  gap:6px;
  width:100%;
}
.qpm-tcmp-metric {
  display:flex;
  align-items:center;
  justify-content:flex-start;
  font-size:12px;
  color:rgba(224,224,224,0.68);
  min-height:18px;
}
.qpm-tcmp-metric--right { justify-content:flex-end; }
.qpm-tcmp-metric-key {
  font-size:9px;
  text-transform:uppercase;
  letter-spacing:0.07em;
  color:rgba(224,224,224,0.43);
  flex-shrink:0;
  white-space:nowrap;
}
.qpm-tcmp-metric-val {
  font-weight:700;
  color:#dfe6ff;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.qpm-tcmp-metric-val--winner { color:#74ffb5; }
.qpm-tcmp-metric-val--rainbow {
  background:linear-gradient(90deg,#ff6f6f,#ffd56b,#77ff9f,#6fc4ff,#d487ff);
  -webkit-background-clip:text;
  background-clip:text;
  -webkit-text-fill-color:transparent;
}
.qpm-tcmp-metric-val--gold { color:#ffd86b; }
.qpm-tcmp-coin {
  width:14px;
  height:14px;
  object-fit:contain;
  image-rendering:pixelated;
  flex-shrink:0;
}
.qpm-tcmp-center {
  display:flex;
  flex-direction:column;
  align-items:stretch;
  justify-content:flex-start;
  gap:8px;
  border:1px solid rgba(143,130,255,0.16);
  border-radius:9px;
  padding:9px 8px;
  background:rgba(143,130,255,0.06);
}
.qpm-tcmp-center-top {
  display:flex;
  flex-direction:column;
  justify-content:center;
  align-items:center;
  gap:8px;
  min-height:88px;
}
.qpm-tcmp-slot { font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:rgba(224,224,224,0.45); text-align:center; }
.qpm-tcmp-verdict {
  font-size:12px;
  font-weight:700;
  padding:4px 9px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.15);
  color:#f5f2ff;
  background:rgba(255,255,255,0.06);
  width:fit-content;
  align-self:center;
}
.qpm-tcmp-verdict--a { border-color:rgba(88,160,255,0.55); background:rgba(88,160,255,0.18); color:#d6e8ff; }
.qpm-tcmp-verdict--b { border-color:rgba(100,255,150,0.55); background:rgba(100,255,150,0.18); color:#d6ffe4; }
.qpm-tcmp-verdict--tie { border-color:rgba(255,255,255,0.28); background:rgba(255,255,255,0.08); color:#ececec; }
.qpm-tcmp-verdict--review { border-color:rgba(255,193,7,0.5); background:rgba(255,193,7,0.14); color:#ffe8a3; }
.qpm-tcmp-ledger {
  display:flex;
  flex-direction:column;
  gap:5px;
  width:100%;
}
.qpm-tcmp-ledger-head,
.qpm-tcmp-ledger-row {
  display:grid;
  grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr);
  align-items:center;
  gap:6px;
}
.qpm-tcmp-ledger-head {
  font-size:10px;
  text-transform:uppercase;
  letter-spacing:0.08em;
  color:rgba(224,224,224,0.46);
  border-bottom:1px solid rgba(143,130,255,0.2);
  padding-bottom:4px;
}
.qpm-tcmp-ledger-row {
  font-size:11px;
  color:rgba(224,224,224,0.72);
}
.qpm-tcmp-ledger-a,
.qpm-tcmp-ledger-b {
  font-weight:700;
  color:#e7e8ff;
}
.qpm-tcmp-ledger-a { text-align:left; }
.qpm-tcmp-ledger-b { text-align:right; }
.qpm-tcmp-ledger-mid {
  text-align:center;
  font-size:9px;
  text-transform:uppercase;
  letter-spacing:0.07em;
  color:rgba(224,224,224,0.46);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.qpm-tcmp-ledger-win { color:#74ffb5; }
.qpm-tcmp-legend {
  display:flex;
  flex-direction:column;
  gap:5px;
  width:100%;
}
.qpm-tcmp-legend-row {
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:18px;
  text-align:center;
  font-size:9px;
  text-transform:uppercase;
  letter-spacing:0.07em;
  color:rgba(224,224,224,0.5);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.qpm-tcmp-stage {
  font-size:10px;
  text-transform:uppercase;
  letter-spacing:0.07em;
  color:rgba(224,224,224,0.5);
  text-align:center;
  border-top:1px solid rgba(143,130,255,0.2);
  padding-top:6px;
}
.qpm-tcmp-filter-row { display:flex; align-items:center; gap:8px; }
.qpm-tcmp-filter-chip {
  font-size:10px;
  color:rgba(224,224,224,0.7);
  border:1px solid rgba(143,130,255,0.25);
  background:rgba(143,130,255,0.1);
  border-radius:999px;
  padding:2px 8px;
  white-space:nowrap;
}
`;
