export type Coord = { col: number; row: number }; // 0-9 each

export type ShipSpec = { id: string; length: number };

export type PlacedShip = { spec: ShipSpec; species: string; cells: Coord[] };

export type FleetLayout = PlacedShip[];

export type ShotVerdict = 'miss' | 'hit' | 'sunk' | 'win';

export type ShotResult = { verdict: ShotVerdict; species?: string };

export type MatchMode = 'solo' | 'mp';

export type MatchPhase = 'idle' | 'waitingAccept' | 'placing' | 'waitingReady' | 'battle' | 'reveal' | 'ended';

export type EndReason =
  | 'win'
  | 'loss'
  | 'resign'
  | 'opponentResign'
  | 'opponentLeft'
  | 'timeoutClaim'
  | 'voidMismatch'
  | 'aborted'
  | 'featureStop';

export type GameMsg =
  // `to` is the target's display name — recipients whose own name matches
  // show the accept card. Names can technically collide inside a room, but
  // mpSession filters incoming accept/verdict msgs by the challenger's stored
  // playerId, so a name collision just means both matched users see the card;
  // whichever one actually accepts is what the challenger locks onto.
  | { kind: 'challenge'; from: string; to: string }
  | { kind: 'accept' }
  | { kind: 'decline' }
  // grid: which of the player's two 10x10 plots hosts their board (0=left, 1=right)
  | { kind: 'ready'; hash8: string; grid: 0 | 1 }
  | { kind: 'shot'; at: Coord }
  | { kind: 'verdict'; at: Coord; result: ShotResult }
  // layoutCompact: 's5:A1h s4:C3v ...' — also the exact hash preimage (with salt).
  // Chat lines truncate at 100 chars server-side, so no JSON payloads on the wire.
  | { kind: 'reveal'; layoutCompact: string; salt: string }
  | { kind: 'resign' }
  | { kind: 'rematch' };
