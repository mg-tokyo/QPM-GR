import { getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';
import { readInventoryDirect, getInventoryItems } from '../../store/inventory';

export const inventoryDebugApi = {
  debugInventory: async () => {
    try {
      const { getAtomByLabel, readAtomValue } = await import('../../core/jotaiBridge');

      console.log('=== Inventory Debug ===\n');

      // Try userSlotsAtom first
      const userSlotsAtom = getAtomByLabel('userSlotsAtom');
      if (userSlotsAtom) {
        const inventory = await readAtomValue(userSlotsAtom);
        console.log('userSlotsAtom inventory:', inventory);

        const plantItems = Array.isArray(inventory) ? inventory.filter((item: any) =>
          item.itemType === 'Plant' ||
          (item.slots && item.slots.length > 0)
        ) : [];
        console.log(`\nFound ${plantItems?.length || 0} plant items:`);
        console.table(plantItems?.map((item: any, i: number) => ({
          Index: i,
          Species: item.species || 'N/A',
          Name: item.name || 'N/A',
          ItemType: item.itemType,
          HasSlots: !!(item.slots && item.slots.length > 0),
          NumSlots: item.slots?.length || 0,
          Keys: Object.keys(item).join(', ')
        })));

        // Show first plant in detail
        if (plantItems && plantItems.length > 0) {
          console.log('\n=== First Plant Item (Full Structure) ===');
          console.log(plantItems[0]);
          if (plantItems[0].slots) {
            console.log('\n=== Slots Detail ===');
            console.log(plantItems[0].slots);
          }
        }

        return { userSlots: inventory, plantItems };
      }

      console.error('❌ userSlotsAtom not found');
      return null;
    } catch (error) {
      console.error('Failed to debug inventory:', error);
      return null;
    }
  },

  // Debug helpers (inventory + seeds + rainbow + Pet Hub)
  debugInventoryAtoms: async (labels: string[] = ['myInventoryAtom', 'myCropInventoryAtom', 'seedInventoryAtom']) => {
    const cache = (window as any).__qpmJotaiAtomCache__;
    const store = (window as any).__qpmJotaiStore__;
    console.log('Atom cache present:', !!cache, 'Store present:', !!store);
    const found: Array<{ label: string; hasValue: boolean }> = [];
    labels.forEach((label) => {
      const atom = getAtomByLabel(label);
      if (atom) {
        const hasValue = !!cache?.has?.(atom);
        found.push({ label, hasValue });
      }
    });
    console.table(found);

    for (const label of labels) {
      const atom = getAtomByLabel(label);
      if (!atom) continue;
      try {
        const value = await readAtomValue<any>(atom);
        console.log(`Value for ${label}:`, value);
      } catch (error) {
        console.error(`Failed reading ${label}`, error);
      }
    }
    return found;
  },

  scanSeeds: async () => {
    const direct = await readInventoryDirect();
    const cached = getInventoryItems();

    const pickQty = (item: any): number | null => {
      const raw = item?.raw ?? {};
      const candidates: Array<unknown> = [
        item.quantity,
        item.count,
        item.amount,
        item.stackSize,
        item.qty,
        item.owned,
        item.quantityOwned,
        raw.quantity,
        raw.count,
        raw.amount,
        raw.stackSize,
        raw.qty,
        raw.owned,
        raw.quantityOwned,
      ];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    };

    const isSeed = (item: any): boolean => {
      const raw = item?.raw ?? {};
      const textFields: Array<unknown> = [
        item.itemType,
        item.name,
        item.displayName,
        item.id,
        item.species,
        raw.itemType,
        raw.type,
        raw.category,
        raw.subType,
        raw.itemCategory,
        raw.itemSubType,
        raw.kind,
      ];
      if (textFields.some((f) => `${f ?? ''}`.toLowerCase().includes('seed'))) return true;
      const tagFields: Array<unknown> = [raw.tags, raw.tagList, raw.itemTags, raw.labels];
      for (const t of tagFields) {
        if (Array.isArray(t) && t.some((v) => `${v ?? ''}`.toLowerCase().includes('seed'))) return true;
      }
      return raw.isSeed === true;
    };

    const scan = (items: any[]) => {
      const seeds = [] as Array<{ id: string; qty: number; name?: string | null }>;
      let max = 0;
      for (const item of items) {
        if (!isSeed(item)) continue;
        const qty = pickQty(item);
        if (!Number.isFinite(qty) || (qty as number) <= 0) continue;
        const id = String(item.id ?? item.itemId ?? item.species ?? item.name ?? 'unknown');
        seeds.push({ id, qty: qty as number, name: item.displayName ?? item.name ?? null });
        max = Math.max(max, qty as number);
      }
      seeds.sort((a, b) => b.qty - a.qty);
      return { max, seeds };
    };

    const directScan = scan(direct?.items ?? []);
    const cachedScan = scan(cached);

    console.log('Seed scan (direct atom read): max', directScan.max, directScan.seeds.slice(0, 10));
    console.log('Seed scan (cached store): max', cachedScan.max, cachedScan.seeds.slice(0, 10));
    return { directScan, cachedScan };
  },
};
