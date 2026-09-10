import { useState } from "react";

import "./App.css";

import MatgoGame from "./MatgoGame";
import GostopGame from "./GostopGame";
import OnlineMatgo from "./online/OnlineMatgo";

import {
  GAME_RULES,
  type GameMode,
} from "./game/rules";

function App() {
  const [selectedMode, setSelectedMode] =
    useState<GameMode | "online" | null>(null);

  /* =========================
     게임 선택 화면
  ========================= */

  if (!selectedMode) {
    return (
      <main className="mode-select-page online-mode-select">
        <section className="mode-select-content">
          <div className="mode-select-title">
            <span className="mode-select-eyebrow">
              HWATU GAME
            </span>

            <h1>
              어떤 게임을 시작하시겠습니까?
            </h1>

            <p>
              플레이할 모드를 선택해주세요.
            </p>
          </div>

          <button type="button" className="online-mode-entry"
            onClick={() => setSelectedMode("online")}>
            <strong>온라인 2인 맞고</strong>
            <span className="mode-card-description">방 코드로 친구와 함께 플레이</span>
          </button>
          <div className="mode-card-list">
            {/* 2인 맞고 */}

            <button
              type="button"
              className="mode-card"
              onClick={() =>
                setSelectedMode("matgo")
              }
            >
              <span className="mode-card-player-count">
                2 PLAYERS
              </span>

              <strong>2인 맞고</strong>

              <span className="mode-card-description">
                빠른 템포의 1 대 1 맞고
              </span>

              <div className="mode-card-info">
                <span>
                  손패{" "}
                  {GAME_RULES.matgo.handSize}
                  장
                </span>

                <span>
                  바닥{" "}
                  {GAME_RULES.matgo.floorSize}
                  장
                </span>

                <span>
                  {GAME_RULES.matgo.goStopScore}
                  점부터 GO / STOP
                </span>
              </div>

              <span className="mode-card-start">
                게임 시작 →
              </span>
            </button>

            {/* 3인 고스톱 */}

            <button
              type="button"
              className="mode-card"
              onClick={() =>
                setSelectedMode("gostop")
              }
            >
              <span className="mode-card-player-count">
                3 PLAYERS
              </span>

              <strong>3인 고스톱</strong>

              <span className="mode-card-description">
                세 명이 함께 플레이하는 고스톱
              </span>

              <div className="mode-card-info">
                <span>
                  손패{" "}
                  {GAME_RULES.gostop.handSize}
                  장
                </span>

                <span>
                  바닥{" "}
                  {GAME_RULES.gostop.floorSize}
                  장
                </span>

                <span>
                  {GAME_RULES.gostop.goStopScore}
                  점부터 GO / STOP
                </span>
              </div>

              <span className="mode-card-start">
                게임 시작 →
              </span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  /* =========================
     2인 맞고
  ========================= */

  if (selectedMode === "online") {
    return <OnlineMatgo onBack={() => setSelectedMode(null)} />;
  }

  if (selectedMode === "matgo") {
    return (
      <>
        <button
          type="button"
          className="mode-back-button"
          onClick={() =>
            setSelectedMode(null)
          }
        >
          ← 게임 선택
        </button>

        <MatgoGame />
      </>
    );
  }

  /* =========================
     3인 고스톱
  ========================= */

  return (
    <>
      <button
        type="button"
        className="mode-back-button mode-back-button--gostop-game"
        onClick={() =>
          setSelectedMode(null)
        }
      >
        ← 게임 선택
      </button>

      <GostopGame />
    </>
  );
}

export default App;
