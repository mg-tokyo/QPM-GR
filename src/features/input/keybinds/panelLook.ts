// A storage panel's name and art from the decor catalog; panel ids match decor ids ignoring case (multi-storage panelIdFor).
import { getAllDecor, getDecor } from '../../../catalogs/gameCatalogs';

export interface PanelLook {
  name: string;
  spriteKey: string | null;
}

export function storagePanelLook(panelId: string): PanelLook | null {
  const wanted = panelId.toLowerCase();
  const decorId = getAllDecor().find(id => id.toLowerCase() === wanted);
  const decor = decorId ? getDecor(decorId) : null;
  if (!decor || typeof decor.name !== 'string' || !decor.name) return null;
  return { name: decor.name, spriteKey: typeof decor.art === 'string' && decor.art ? decor.art : null };
}
