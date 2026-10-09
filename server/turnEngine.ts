import * as matgo from "../src/game/turn";
import * as gostop from "../src/game/gostopTurn";
import type { GameMode } from "../src/game/rules";

// The online state uses absolute seat numbers. Only this adapter translates the
// two-player engine's player/opponent names; neither single-player engine changes.
const seat = (owner: matgo.PlayerSide): 0 | 1 => owner === "player" ? 0 : 1;
const side = (owner: gostop.GostopPlayerIndex): matgo.PlayerSide => {
  if (owner === 2) throw new Error("맞고에는 2번 좌석이 없습니다.");
  return owner === 0 ? "player" : "opponent";
};
const toMatgoStacks = (stacks: gostop.GostopPpeokStack[]): matgo.PpeokStack[] =>
  stacks.map(s => ({ ...s, owner: side(s.owner) }));
const toSeats = (stacks: matgo.PpeokStack[]): gostop.GostopPpeokStack[] =>
  stacks.map(s => ({ ...s, owner: seat(s.owner) }));
const toPrepared = (p: gostop.GostopPreparedPlay): matgo.PreparedPlay =>
  ({ ...p, owner: side(p.owner), ppeokStacks: toMatgoStacks(p.ppeokStacks) });
function toResult(result: matgo.DrawResult): gostop.GostopDrawResult {
  const ppeokStacks = toSeats(result.ppeokStacks);
  return result.type === "choice" ? { ...result, owner: seat(result.owner), ppeokStacks }
    : { ...result, ppeokStacks };
}

const three = {
  prepareHandPlay: gostop.prepareGostopHandPlay,
  finalizePreparedPlay: gostop.finalizeGostopPreparedPlay,
  resolveTurnDraw: gostop.resolveGostopTurnDraw,
  resolveDrawOnly: gostop.resolveGostopDrawOnly,
  resolveDrawChoice: gostop.resolveGostopDrawChoice,
  applyPansseul: gostop.applyGostopPansseul,
  stealPiCards: gostop.stealGostopPiCards,
  getBombActionForMonth: gostop.getGostopBombActionForMonth,
  canShakeMonth: gostop.canGostopShakeMonth,
};
const two: typeof three = {
  prepareHandPlay(card, floor, owner, stacks, selected) {
    const result = matgo.prepareHandPlay(card, floor, side(owner), toMatgoStacks(stacks), selected);
    return result.type === "choice" ? result : { type: "ready", prepared: {
      ...result.prepared, owner, ppeokStacks: toSeats(result.prepared.ppeokStacks),
    } };
  },
  finalizePreparedPlay(prepared) {
    const result = matgo.finalizePreparedPlay(toPrepared(prepared));
    return { ...result, ppeokStacks: toSeats(result.ppeokStacks) };
  },
  resolveTurnDraw: (prepared, drawn) => toResult(matgo.resolveTurnDraw(toPrepared(prepared), drawn)),
  resolveDrawOnly: (drawn, floor, owner, stacks, captured, steal, events) =>
    toResult(matgo.resolveDrawOnly(drawn, floor, side(owner), toMatgoStacks(stacks), captured, steal, events)),
  resolveDrawChoice(choice, selected) {
    const result = matgo.resolveDrawChoice({ ...choice, owner: side(choice.owner),
      ppeokStacks: toMatgoStacks(choice.ppeokStacks) }, selected);
    return { ...result, ppeokStacks: toSeats(result.ppeokStacks) };
  },
  applyPansseul(raw, remaining) {
    const result = matgo.applyPansseul({ ...raw, ppeokStacks: toMatgoStacks(raw.ppeokStacks) }, remaining);
    return { ...result, ppeokStacks: toSeats(result.ppeokStacks) };
  },
  stealPiCards: matgo.stealPiCards,
  getBombActionForMonth: matgo.getBombActionForMonth,
  canShakeMonth: matgo.canShakeMonth,
};

export const turnEngine = (mode: GameMode) => mode === "gostop" ? three : two;
