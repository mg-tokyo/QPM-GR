import { describe, expect, it } from 'vitest';
import { findMutationColorMap } from './mutationColorParsing';

const CATALOG_KEYS = ['Gold', 'Rainbow', 'Wet', 'Chilled', 'Frozen', 'Thunderstruck', 'Dawnlit', 'Ambershine', 'Dawncharged', 'Ambercharged', 'Thundercharged'];

// Verbatim from Game 1099 `localization-D6HABXmg.js` (captured live 2026-09-08):
// each entry is an object with `solid` (+ optional `gradient`), and the
// ability-colour objects that follow share the same `{solid:…}` shape.
const V1099 = 'Dp(Ep),c([`Dirt`,`Boardwalk`]);var Op={Gold:{solid:`rgb(235, 200, 0)`},Rainbow:{solid:`#D02128`,gradient:{angleDegrees:135,colorStops:[{color:`#D02128`,offset:0},{color:`#D94C52`,offset:1/7},{color:`#FC6D30`,offset:2/7},{color:`#E9B52F`,offset:3/7},{color:`#5EAC46`,offset:4/7},{color:`#48ADF4`,offset:5/7},{color:`#6D1CF0`,offset:6/7},{color:`#AE53B0`,offset:1}]}},Wet:{solid:`rgba(95, 255, 255, 1)`},Chilled:{solid:`rgba(180, 230, 255, 1)`},Frozen:{solid:`rgb(185, 200, 255)`},Thunderstruck:{solid:`rgb(255, 247, 0)`},Dawnlit:{solid:`rgb(245, 155, 225)`},Ambershine:{solid:`rgb(255, 180, 120)`},Dawncharged:{solid:`rgb(200, 150, 255)`},Ambercharged:{solid:`rgb(250, 140, 75)`},Thundercharged:{solid:`rgb(112, 246, 203)`}},kp=`#00D4A9`,Ap={solid:`#DCC846`,gradient:{angleDegrees:135,colorStops:[{color:`#DCC846`,offset:0},{color:`#D2AF05`,offset:.4}]}},Mp=e=>{switch(e){case`MoonKisser`:return{solid:`#FAA623`};case`ProduceScaleBoost`:return{solid:`#228B22`};default:return{solid:`#969696`}}};';

// Pre-v1040 flat table shape the extractor was written against.
const LEGACY = 'var Op={Gold:`rgb(235, 200, 0)`,Rainbow:`#D02128`,Wet:`rgba(95, 255, 255, 1)`,Chilled:`rgba(180, 230, 255, 1)`,Frozen:`rgb(185, 200, 255)`,Thunderstruck:`rgb(255, 247, 0)`,Dawnlit:`rgb(245, 155, 225)`,Ambershine:`rgb(255, 180, 120)`},kp=`#00D4A9`;';

describe('findMutationColorMap', () => {
  it('parses the Game 1099 {solid, gradient} table and returns the solid colour per mutation', () => {
    const map = findMutationColorMap(V1099, CATALOG_KEYS);
    expect(map).not.toBeNull();
    for (const key of CATALOG_KEYS) expect(map![key], key).toBeTruthy();
    expect(map!.Gold).toBe('rgb(235, 200, 0)');
    expect(map!.Rainbow).toBe('#D02128');
    expect(map!.Thundercharged).toBe('rgb(112, 246, 203)');
    // Gradient stop colours never shadow a real entry.
    expect(map!.Rainbow).not.toBe('#D94C52');
  });

  it('still parses the legacy flat table', () => {
    const map = findMutationColorMap(LEGACY, CATALOG_KEYS);
    expect(map).not.toBeNull();
    expect(map!.Gold).toBe('rgb(235, 200, 0)');
    expect(map!.Ambershine).toBe('rgb(255, 180, 120)');
  });

  it('rejects text where the anchors exist but no table overlaps the catalog keys', () => {
    const decoy = 'var X={Foo:{solid:`rgb(235, 200, 0)`},Bar:{solid:`#111111`}};case`Thunderstruck:`:return 1;';
    expect(findMutationColorMap(decoy, CATALOG_KEYS)).toBeNull();
  });
});
