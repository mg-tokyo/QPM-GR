import { t } from '../../../i18n';
import { renderPickATileGarden } from './pickATileGarden';
import { renderPickATilePets } from './pickATilePets';

type SubTabId = 'garden' | 'pets';

export function renderPickATilePanel(opts: {
  onPickTile: (tileKey: string, species: string, objectType: string, liveSlotCount: number) => void;
  onPickPetSlot: (slotIndex: 0 | 1 | 2, species: string) => void;
  highlightSpecies?: string;
}): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';

  let active: SubTabId = 'garden';
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;';

  const renderBody = (): void => {
    body.replaceChildren();
    const highlight = opts.highlightSpecies;
    if (active === 'garden') {
      const gardenOpts = highlight
        ? { onPick: opts.onPickTile, highlightSpecies: highlight }
        : { onPick: opts.onPickTile };
      void renderPickATileGarden(gardenOpts).then(el => {
        if (active === 'garden') body.appendChild(el);
      });
    } else {
      const petsOpts = highlight
        ? { onPick: opts.onPickPetSlot, highlightSpecies: highlight }
        : { onPick: opts.onPickPetSlot };
      body.appendChild(renderPickATilePets(petsOpts));
    }
  };

  const buildTabRow = (): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;padding:8px 12px;flex-shrink:0;';
    const mkSubTab = (id: SubTabId, label: string): HTMLElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      const isActive = active === id;
      btn.style.cssText = `padding:4px 12px;border-radius:9999px;background:${isActive ? 'rgba(100,200,255,0.25)' : 'rgba(255,255,255,0.06)'};color:${isActive ? '#bde6ff' : 'rgba(255,255,255,0.7)'};cursor:pointer;border:none;font-family:var(--qpm-font);font-size:12px;`;
      btn.addEventListener('click', () => {
        active = id;
        renderBody();
        root.replaceChildren(buildTabRow(), body);
      });
      return btn;
    };
    row.appendChild(mkSubTab('garden', t('feature.gardenPainter.pickATile.gardenSubTab')));
    row.appendChild(mkSubTab('pets', t('feature.gardenPainter.pickATile.petsSubTab')));
    return row;
  };

  root.appendChild(buildTabRow());
  root.appendChild(body);
  renderBody();
  return root;
}
