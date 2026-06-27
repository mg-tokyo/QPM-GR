// WeakMap<RiveSprite, petId> — populated at Rive pet sprite construction, queried by matcher/scope.ts
const riveToPetId = new WeakMap<object, string>();

export function registerRiveSprite(riveSprite: object, petId: string): void {
  riveToPetId.set(riveSprite, petId);
}

export function lookupPetIdForRive(riveSprite: object): string | null {
  return riveToPetId.get(riveSprite) ?? null;
}

export function unregisterRiveSprite(riveSprite: object): void {
  riveToPetId.delete(riveSprite);
}
