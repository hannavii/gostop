export type GameMode =
  | "matgo"
  | "gostop";

export const GAME_RULES = {
  matgo: {
    playerCount: 2,
    handSize: 10,
    floorSize: 8,
    goStopScore: 7,
  },

  gostop: {
    playerCount: 3,
    handSize: 7,
    floorSize: 6,
    goStopScore: 3,
  },
} as const;