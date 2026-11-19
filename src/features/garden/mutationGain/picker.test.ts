import { describe, expect, it } from 'vitest';
import { buildPickerSections } from './picker';

// Lower-case ids: the shape mirrors the beta mutationsDex families (Growth, Hydro, Lunar).
const families = new Map<string, string>([
  ['gold', 'growth'], ['rainbow', 'growth'],
  ['wet', 'hydro'], ['chilled', 'hydro'], ['frozen', 'hydro'], ['thunder', 'hydro'],
  ['dawnlit', 'lunar'], ['dawnbound', 'lunar'],
]);
const groupOf = (id: string): string | null => families.get(id) ?? null;
const ids = [...families.keys()];
const weathers = [
  { name: 'Sunny', spriteKey: 'sun', mutation: null },
  { name: 'Rain', spriteKey: 'rain', mutation: 'wet' },
  { name: 'Snow', spriteKey: 'snow', mutation: 'chilled' },
  { name: 'Storm', spriteKey: 'storm', mutation: 'thunder' },
  { name: 'Dawn', spriteKey: 'dawn', mutation: 'dawnlit' },
];

describe('buildPickerSections', () => {
  it('makes one section per weather family, titled by its weathers, in catalog order', () => {
    const sections = buildPickerSections(ids, groupOf, weathers);
    expect(sections.map((s) => s.weathers.map((w) => w.name))).toEqual([[], ['Rain', 'Snow', 'Storm'], ['Dawn']]);
    expect(sections[1]?.mutations.map((m) => m.id)).toEqual(['wet', 'chilled', 'frozen', 'thunder']);
  });

  it('names the weather that applies a mutation and leaves combines and ability mutations unnamed', () => {
    const hydro = buildPickerSections(ids, groupOf, weathers)[1]?.mutations ?? [];
    expect(hydro).toEqual([
      { id: 'wet', weather: 'Rain' },
      { id: 'chilled', weather: 'Snow' },
      { id: 'frozen', weather: null },
      { id: 'thunder', weather: 'Storm' },
    ]);
  });

  it('merges every family no weather reaches into one section', () => {
    const sections = buildPickerSections([...ids, 'eclipse'], (id) => groupOf(id) ?? (id === 'eclipse' ? 'void' : null), weathers);
    expect(sections[0]?.weathers).toEqual([]);
    expect(sections[0]?.mutations.map((m) => m.id)).toEqual(['gold', 'rainbow', 'eclipse']);
    expect(sections).toHaveLength(3);
  });

  it('ignores weathers whose mutation the catalog does not list', () => {
    const sections = buildPickerSections(['gold'], groupOf, weathers);
    expect(sections).toEqual([{ weathers: [], mutations: [{ id: 'gold', weather: null }] }]);
  });

  it('keeps a family-less weather mutation in its own weather section', () => {
    const sections = buildPickerSections(['gold', 'mud'], groupOf, [{ name: 'Swamp', spriteKey: null, mutation: 'mud' }]);
    expect(sections.map((s) => s.weathers.map((w) => w.name))).toEqual([[], ['Swamp']]);
  });

  it('returns nothing while the catalog is empty', () => {
    expect(buildPickerSections([], groupOf, weathers)).toEqual([]);
  });
});
