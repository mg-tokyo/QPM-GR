import { t } from '../../../i18n';
import { createEmptyState } from '../../../ui/components';
import { WAYPOINT_CAP, WAYPOINT_NAME_MAX, type Waypoint } from '../waypoints';
import { barButton, setEnabled, toolButton } from './buttons';

export interface WaypointMenuSource {
  list(): readonly Waypoint[];
  /** The last saved or flown to; highlighted. */
  currentId(): string | null;
  /** The save key as the player reads it, e.g. "B". */
  saveKey(): string;
  fly(id: string): void;
  save(): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
}

export interface WaypointMenu {
  el: HTMLElement;
  render(): void;
  /** Commits a rename being typed; the bar calls it as its popover closes. */
  endEdit(): void;
  destroy(): void;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
};

const setText = (el: Element | null | undefined, text: string): void => { if (el && el.textContent !== text) el.textContent = text; };

/** The bar's Waypoints popover (PW1, 2026-10-10). One element for the session; render() updates it in place. */
export function createWaypointMenu(src: WaypointMenuSource): WaypointMenu {
  let destroyed = false;
  let empty: HTMLElement | null = null;
  let editing: ((commit: boolean) => void) | null = null;
  const el = node('div', 'qpm-spec-wp');
  const save = barButton('', 'secondary', () => { src.save(); });
  const count = node('span', 'qpm-spec-wp-count');
  const head = node('div', 'qpm-spec-wp-hd');
  head.append(save, count);
  const list = node('div', 'qpm-spec-wp-list');
  el.append(head, list);

  // The field takes the name's place; Enter, a blur or the popover closing saves, Esc puts the name back. Keys typed
  // here never reach the spectator router (it skips editable targets), and Enter / Esc stop at the field.
  function rename(row: HTMLElement, fly: HTMLButtonElement, id: string): void {
    const w = src.list().find((x) => x.id === id);
    if (!w || row.hasAttribute('data-editing')) return;
    editing?.(true);
    const field = node('input', 'qpm-input qpm-spec-wp-input');
    field.type = 'text';
    field.value = w.name;
    field.maxLength = WAYPOINT_NAME_MAX;
    field.setAttribute('aria-label', t('feature.spectator.wp.nameLabel'));
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      if (editing === finish) editing = null;
      row.removeAttribute('data-editing');
      field.remove();
      fly.hidden = false;
      if (commit) src.rename(id, field.value);
    };
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(e.key === 'Enter');
    });
    field.addEventListener('blur', () => { finish(true); });
    editing = finish;
    row.setAttribute('data-editing', '');
    fly.hidden = true;
    row.prepend(field);
    field.focus();
    field.select();
  }

  function createRow(id: string): HTMLElement {
    const row = node('div', 'qpm-spec-wp-row');
    row.dataset.wpId = id;
    const fly = node('button', 'qpm-spec-wp-fly');
    fly.type = 'button';
    fly.append(node('span', 'qpm-spec-wp-name'));
    fly.addEventListener('click', () => { src.fly(id); });
    const ren = toolButton('rename', t('feature.spectator.wp.rename'), 'ghost', () => { rename(row, fly, id); });
    const del = toolButton('remove', t('feature.spectator.wp.delete'), 'ghost', () => { src.remove(id); });
    ren.classList.add('qpm-spec-wp-act');
    del.classList.add('qpm-spec-wp-act');
    row.append(fly, ren, del);
    return row;
  }

  function updateRow(row: HTMLElement, w: Waypoint, current: boolean): void {
    row.setAttribute('aria-current', String(current));
    const fly = row.querySelector('.qpm-spec-wp-fly');
    const label = t('feature.spectator.wp.fly', { name: w.name });
    if (fly && fly.getAttribute('aria-label') !== label) {
      fly.setAttribute('aria-label', label);
      fly.setAttribute('title', label);
    }
    setText(row.querySelector('.qpm-spec-wp-name'), w.name);
  }

  // Rows are reused, and the list is only rebuilt when its order changes: rebuilding would drop a field being typed in.
  function render(): void {
    if (destroyed) return;
    const items = src.list();
    const key = src.saveKey();
    setText(save, t('feature.spectator.wp.save', { key }));
    setEnabled(save, items.length < WAYPOINT_CAP);
    setText(count, t('feature.spectator.wp.count', { n: items.length, max: WAYPOINT_CAP }));
    if (items.length === 0) {
      empty ??= createEmptyState('');
      setText(empty.firstElementChild, t('feature.spectator.wp.empty', { key }));
      if (list.firstChild !== empty || list.childNodes.length !== 1) {
        editing?.(false);
        list.replaceChildren(empty);
      }
      return;
    }
    const shown = [...list.children].map((r) => (r instanceof HTMLElement ? r.dataset.wpId : undefined));
    const reorder = items.length !== shown.length || items.some((w, i) => shown[i] !== w.id);
    // A field moved by the rebuild gets no reliable blur: commit it first (its write may redraw), then draw from fresh data.
    if (reorder && editing) {
      editing(true);
      render();
      return;
    }
    const kept = new Map<string, HTMLElement>();
    for (const r of list.querySelectorAll<HTMLElement>(':scope > .qpm-spec-wp-row')) if (r.dataset.wpId) kept.set(r.dataset.wpId, r);
    const cur = src.currentId();
    const rows = items.map((w) => {
      const row = kept.get(w.id) ?? createRow(w.id);
      updateRow(row, w, w.id === cur);
      return row;
    });
    if (reorder) list.replaceChildren(...rows);
  }

  render();
  return {
    el,
    render,
    endEdit() { editing?.(true); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      el.remove();
    },
  };
}
