import { useState } from "react";

import "./App.css";

import MatgoGame from "./MatgoGame";
import GostopGame from "./GostopGame";
import OnlineMatgo from "./online/OnlineMatgo";
import { readReconnectSession } from "./online/reconnectSession";
import { readRoomInvite } from "./online/inviteUrl";

import type { GameMode } from "./game/rules";

function App() {
  const [selectedMode, setSelectedMode] =
    useState<GameMode | "online" | null>(() => readReconnectSession() || readRoomInvite(window.location.search).present ? "online" : null);

  /* =========================
     게임 선택 화면
  ========================= */

  if (!selectedMode) {
    return (
      <main className="mode-select-page online-mode-select">
        <div className="mode-select-content">
          <header className="mode-select-title">
            <span className="mode-select-eyebrow">함께 즐기는 화투</span>
            <h1>온라인 맞고 / 고스톱</h1>
            <p>친구와 한 판, 언제 어디서나 함께하세요.</p>
          </header>

          <section className="home-online-primary" aria-labelledby="home-online-heading">
            <span className="home-online-label">친구와 실시간 대전</span>
            <h2 id="home-online-heading">함께 치는 즐거움</h2>
            <p>둘이서는 맞고, 셋이서는 고스톱.<br />방을 만들거나 참가해 함께 플레이하세요.</p>
            <button type="button" className="online-mode-entry"
              onClick={() => setSelectedMode("online")}>
              <strong>온라인 플레이</strong><span aria-hidden="true">→</span>
            </button>
            <p className="home-online-features">방 만들기 · 코드 참가 · 공개방 · 최근 경기</p>
          </section>

          <section className="home-ai-secondary" aria-labelledby="home-ai-heading">
            <div className="home-ai-heading">
              <h2 id="home-ai-heading">AI 연습</h2>
              <p>혼자서 가볍게 한 판</p>
            </div>
            <div className="home-ai-actions">
              <button type="button" className="home-ai-button" onClick={() => setSelectedMode("matgo")}>
                AI 2인 맞고
              </button>
              <button type="button" className="home-ai-button" onClick={() => setSelectedMode("gostop")}>
                AI 3인 고스톱
              </button>
            </div>
          </section>
        </div>
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
