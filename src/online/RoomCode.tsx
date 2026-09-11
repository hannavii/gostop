import { useState } from "react";

export default function RoomCode({ code }: { code: string }) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setFeedback("방 코드를 복사했습니다.");
    } catch {
      setFeedback("복사할 수 없습니다. 방 코드를 직접 선택해 복사해주세요.");
    }
  }
  return <div className="online-room-code">
    <span>방 코드: <strong className="online-code" tabIndex={0}>{code}</strong></span>
    <button type="button" onClick={() => void copy()}>방 코드 복사</button>
    {feedback && <small role="status">{feedback}</small>}
  </div>;
}
