import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OnlineGameBoard from "../src/online/OnlineGameBoard";
import CapturedCardsModal from "../src/components/CapturedCardsModal";
import MatgoTable from "../src/components/MatgoTable";
import { hwatuCards } from "../src/data/cards";
import type { GameView, Seat } from "../shared/online";

function fixture(): GameView {
  return {
    revision: 1, turn: 0, phase: "play", hand: hwatuCards.slice(0, 2),
    players: [
      { seat: 0, handCount: 2, captured: [], score: 17, goCount: 2, bombCount: 1, bombPassCount: 2, shakeMonths: [1] },
      { seat: 1, handCount: 7, captured: [], score: 19, goCount: 3, bombCount: 0, bombPassCount: 0, shakeMonths: [] },
    ],
    floor: hwatuCards.slice(4, 7), drawCount: 10, choice: null,
    revealed: [], specialEvents: [], ppeokStacks: [], result: null, specialOptions: [],
  };
}
function board(game: GameView, you: Seat = 0) {
  return renderToStaticMarkup(createElement(OnlineGameBoard, {
    game, room: { code: "ABC123", you, occupancy: 2, game }, enabled: true,
    message: "", act() {}, onSync() {}, onLeave() {},
  }));
}
test("online uses shared table, captured panels, speed and authoritative scores for both seats", () => {
  for (const seat of [0, 1] as const) {
    const html = board(fixture(), seat);
    for (const name of ["game online-matgo-game", "opponent-area", "player-area", "table-content", "draw-pile-area", "captured-panel--left", "captured-panel--right"]) assert.ok(html.includes(name), name);
    assert.match(html, /--special-effect-duration:900ms/);
    assert.match(html, /17점/);
    assert.match(html, /19점/);
    assert.match(html, /2 GO/);
    assert.match(html, /3 GO/);
    const opponentHand = html.split('aria-label="상대 손패">')[1].split('</section>')[0];
    assert.equal((opponentHand.match(/class="card-back"/g) ?? []).length, seat === 0 ? 7 : 2);
    assert.ok(!opponentHand.includes('class="card '));
  }
});
test("floor choices and GO/STOP are shown only to the acting seat", () => {
  const game = fixture();
  game.phase = "choose";
  game.choice = game.floor.slice(0, 2);
  assert.equal((board(game).match(/selectable/g) ?? []).length, 2);
  assert.equal((board(game, 1).match(/selectable/g) ?? []).length, 0);
  game.phase = "go-stop";
  game.choice = null;
  assert.match(board(game), /go-stop-modal/);
  assert.ok(!board(game, 1).includes('go-stop-modal'));
});

test("server shake records and bomb passes render for both seats with action only on own turn", () => {
  const game = fixture();
  assert.match(board(game), /폭탄 패 사용 · 더미만 뒤집기 \(2\)/);
  assert.ok(!board(game, 1).includes('bomb-pass-button'));
  for (const seat of [0, 1] as const) {
    assert.match(board(game, seat), /흔들기 공개/);
    assert.match(board(game, seat), /1월/);
  }
  game.phase = "choose";
  assert.ok(!board(game).includes('bomb-pass-button'));
});
test("online captured modal uses server score without recalculating empty captured cards", () => {
  const html = renderToStaticMarkup(createElement(CapturedCardsModal, {
    title: "내 먹은 패", cards: [], totalScore: 123, onClose() {},
  }));
  assert.match(html, /123점/);
});
test("shared table preserves ppeok grouping, expanded detail and played-card overlay", () => {
  const cards = hwatuCards.filter(card => card.month === 1);
  const html = renderToStaticMarkup(createElement(MatgoTable, {
    floorCards: cards.slice(0, 3), ppeokStacks: [{ month: 1, owner: "player" }],
    expandedPpeokMonth: 1, setExpandedPpeokMonth() {}, pendingChoice: null,
    gameStarted: true, gameOver: false, isAnimating: false, turnMessage: "",
    drawCount: 5, handleFloorCardChoice() {},
  }));
  assert.match(html, /ppeok-stack-slot is-open/);
  assert.match(html, /내가 만든 뻑/);
  assert.match(html, /ppeok-stack-detail-cards/);
  const overlay = renderToStaticMarkup(createElement(MatgoTable, {
    floorCards: cards.slice(0, 1), ppeokStacks: [], expandedPpeokMonth: null,
    setExpandedPpeokMonth() {}, pendingChoice: null, gameStarted: true,
    gameOver: false, isAnimating: true, turnMessage: "", drawCount: 5,
    pendingPlayedVisual: { card: cards[1], targetCardId: cards[0].id, owner: "player" },
    handleFloorCardChoice() {},
  }));
  assert.match(overlay, /played-card-overlay--player/);
});
