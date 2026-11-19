// Live build 2082 excerpts (2026-11-19). Rules body, definitions and binding names are verbatim;
// the import/export clauses are rebuilt from the live bindings (the real ones list many more names).
export const BASE = 'https://magicgarden.gg/version/2082/assets/';

export const RULES_URL = `${BASE}villageDirectory-_CKNQ4JI.js`;
export const RULES = 'import{sr as ve,Wr as ge}from"./subscribeAtom-DPH5BClI.js";import{o as nt,t as w}from"./tools-QPJJ44nY.js";import{Xr as at}from"./inventoryAtoms-k-dI6XBq.js";'
  + 'var k=e=>l(Ye,e)?Xe[e]?.seed:void 0,A=e=>l(tt,e)?$e[e]:void 0,j=e=>l(Ze,e)?Qe[e]:void 0,M=e=>l(w,e)?et[e]:void 0,ft=[`ChilledPotion`,`FrozenPotion`,`ReplenishPotion`,`XPPotion`,...at],pt=new Set(ft);function N(e){return e.some(e=>e!==ve.Spooky)}'
  + 'var P={QuinoaSeedInStock:{subject:`QuinoaSeedInStock`,itemType:m.Seed,idSchema:Ye,itemIdOf:e=>e.itemType===m.Seed?e.species:null,eligibleShopsOf:e=>k(e)?.eligibleShops??[],rarityOf:e=>k(e)?.rarity,displayNameOf:e=>k(e)?.name??e,spritePathOf:e=>`sprite/seed/${e}.png`,headingEmoji:`🌱`,isNotifiable:e=>N(k(e)?.eligibleShops??[])},'
  + 'QuinoaEggInStock:{subject:`QuinoaEggInStock`,itemType:m.Egg,idSchema:tt,itemIdOf:e=>e.itemType===m.Egg?e.eggId:null,eligibleShopsOf:e=>A(e)?.eligibleShops??[],rarityOf:e=>A(e)?.rarity,displayNameOf:e=>A(e)?.name??e,spritePathOf:e=>`sprite/pet/${e}.png`,headingEmoji:`🥚`,isNotifiable:e=>N(A(e)?.eligibleShops??[])},'
  + 'QuinoaToolInStock:{subject:`QuinoaToolInStock`,itemType:m.Tool,idSchema:w,itemIdOf:e=>e.itemType===m.Tool?e.toolId:null,eligibleShopsOf:e=>M(e)?.eligibleShops??[],rarityOf:e=>M(e)?.rarity,displayNameOf:e=>M(e)?.name??e,spritePathOf:e=>`${M(e)?.sprite??`sprite/item/${e}`}.png`,headingEmoji:`🧪`,isNotifiable:e=>l(w,e)&&pt.has(e)&&N(M(e)?.eligibleShops??[])},'
  + 'QuinoaDecorInStock:{subject:`QuinoaDecorInStock`,itemType:m.Decor,idSchema:Ze,itemIdOf:e=>e.itemType===m.Decor?e.decorId:null,eligibleShopsOf:e=>j(e)?.eligibleShops??[],rarityOf:e=>j(e)?.rarity,displayNameOf:e=>j(e)?.name??e,spritePathOf:e=>{let t=j(e);return`${t?rt(t):`sprite/decor/${e}`}.png`},headingEmoji:`✨`,isNotifiable:e=>!nt.some(t=>t===e)&&N(j(e)?.eligibleShops??[])}},'
  + 'mt=new Map(Object.values(P).map(e=>[e.subject,e])),ht=new Map(Object.values(P).map(e=>[e.itemType,e]));function gt(e){return mt.get(e)}function _t(e){return ht.get(e.itemType)}'
  + 'var F=[`sunset`,`midnight`,`sunrise`],vt=s(F);function yt(e){return F.includes(e)}var bt=Object.values(P).map(e=>d({subject:c(e.subject),itemId:e.idSchema})),xt=d({subject:c(`QuinoaWeatherActive`),itemId:ge}),I={subject:`QuinoaDailyQuestsReady`,itemId:`daily`},St=d({subject:c(I.subject),itemId:c(I.itemId)}),Ct=d({subject:c(`QuinoaDayNightPhase`),itemId:vt}),[wt,...Tt]=[...bt,xt,St,Ct];';

export const SUBSCRIBE_URL = `${BASE}subscribeAtom-DPH5BClI.js`;
export const SUBSCRIBE = 'var Qe=function(e){return e.Seed=`seed`,e.Egg=`egg`,e.Tool=`tool`,e.Decor=`decor`,e.Rain=`rain`,e.Dawn=`dawn`,e.Amber=`amber`,e.Snow=`snow`,e.Thunder=`thunder`,e.Apology=`apology`,e.Spooky=`spooky`,e}({});'
  + 'var M=function(e){return e.Rain=`Rain`,e.Frost=`Frost`,e.Thunderstorm=`Thunderstorm`,e.Dawn=`Dawn`,e.AmberMoon=`AmberMoon`,e}({}),Se=n(M),N={Animation:{ActivationTile:`sprite/animation/ActivationTile`}};'
  + 'export{Qe as sr,Se as Wr};';

export const TOOLS_URL = `${BASE}tools-QPJJ44nY.js`;
export const TOOLS = 'We=Object.keys(Z);function Ge(e){return Z[e].canDisplayCrop===!0}var Ke=[`FeedingTrough`,`DecorShed`,`PetHutch`,`SeedSilo`,`ToolShack`],qe=[`SeedSilo`,`PetHutch`,`DecorShed`,`ToolShack`,`FeedingTrough`];function Je(e){return qe.some(t=>t===e)}'
  + 'export{Ke as o,We as t};';

export const INVENTORY_URL = `${BASE}inventoryAtoms-k-dI6XBq.js`;
export const INVENTORY = 'var et=e(f(),1),tt=S([`RainWard`,`SnowWard`,`ThunderWard`,`Hunger`,`XP`,`Strength`]),nt=14400,rt=nt*3,it={RainWard:`RainWardShard`,SnowWard:`SnowWardShard`,ThunderWard:`ThunderWardShard`,Hunger:`HungerShard`,XP:`XPShard`,Strength:`StrengthShard`},at=[`RainWardShard`,`SnowWardShard`,`ThunderWardShard`,`HungerShard`,`XPShard`,`StrengthShard`],ot=S(at),st={RainWard:4,SnowWard:4,ThunderWard:4,Hunger:1,XP:1,Strength:1};'
  + 'export{at as Xr};';
