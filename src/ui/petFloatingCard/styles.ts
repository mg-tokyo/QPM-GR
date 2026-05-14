export const STYLES = `
.qpm-float-card {
  position: fixed;
  background: rgba(18,20,26,0.96);
  border: 1px solid rgba(143,130,255,0.45);
  border-radius: 9px;
  width: 172px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.55);
  z-index: 999990;
  font-family: inherit;
  user-select: none;
  overflow: hidden;
}
.qpm-float-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: grab;
  background: rgba(143,130,255,0.08);
  border-bottom: 1px solid rgba(143,130,255,0.18);
}
.qpm-float-card__header:active { cursor: grabbing; }
.qpm-float-card__sprite-wrap {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  border-radius: 4px;
  transition: box-shadow 0.15s;
}
.qpm-float-card__sprite-wrap:hover {
  box-shadow: 0 0 0 1px rgba(143,130,255,0.3);
}
.qpm-float-card__sprite {
  width: 24px;
  height: 24px;
  image-rendering: pixelated;
  object-fit: contain;
}
.qpm-float-card__name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qpm-float-card__close {
  width: 18px;
  height: 18px;
  background: none;
  border: none;
  color: rgba(224,224,224,0.45);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
  transition: color 0.12s, background 0.12s;
}
.qpm-float-card__close:hover { color: #e0e0e0; background: rgba(255,255,255,0.1); }
.qpm-float-card__body {
  padding: 7px 9px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qpm-float-card__hunger {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qpm-float-card__hunger-pct {
  font-size: 11px;
  color: rgba(224,224,224,0.55);
  min-width: 30px;
  text-align: right;
}
.qpm-float-card__hunger-track {
  flex: 1;
  height: 5px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}
.qpm-float-card__hunger-fill {
  height: 100%;
  border-radius: 3px;
}
.qpm-float-card__hunger-preview {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 3px;
  background: rgba(100, 255, 150, 0.3);
  transition: width 0.15s ease, opacity 0.15s ease;
  width: 0;
  opacity: 0;
  pointer-events: none;
}
.qpm-float-card__feed-btn {
  width: 100%;
  background: rgba(143,130,255,0.2);
  border: 1px solid rgba(143,130,255,0.45);
  border-radius: 5px;
  color: #d0c8ff;
  font-size: 12px;
  font-weight: 500;
  min-height: 30px;
  padding: 5px 8px;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.qpm-float-card__feed-btn:hover { background: rgba(143,130,255,0.35); }
.qpm-float-card__feed-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.qpm-float-card__feed-label { pointer-events: none; flex-shrink: 0; }
.qpm-float-card__feed-preview {
  position: absolute;
  right: -6px;
  top: -9px;
  font-size: 9px;
  font-weight: 700;
  color: #64ff96;
  opacity: 0;
  transform: rotate(12deg);
  transition: opacity 0.12s ease;
  pointer-events: none;
  white-space: nowrap;
  text-shadow: 0 0 3px rgba(0,0,0,0.6);
}
.qpm-float-card__food-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  margin-left: auto;
  pointer-events: none;
}
.qpm-float-card__food {
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(143,130,255,0.09);
  border: 1px solid rgba(143,130,255,0.22);
  border-radius: 999px;
  padding: 1px 5px;
  font-size: 10px;
  color: rgba(224,224,224,0.72);
  pointer-events: none;
  flex-shrink: 0;
  position: relative;
}
.qpm-float-card__food-icon {
  width: 10px;
  height: 10px;
  image-rendering: pixelated;
  object-fit: contain;
}
.qpm-float-card__food-fallback {
  font-size: 10px;
  min-width: 12px;
  text-align: center;
  color: rgba(224,224,224,0.82);
}
.qpm-float-card__food-count {
  font-weight: 700;
  color: #ecefff;
}
.qpm-float-card__no-pet {
  font-size: 11px;
  color: rgba(224,224,224,0.35);
  text-align: center;
  padding: 4px 0;
}
`;
