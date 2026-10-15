import { useState } from "react";
import { createInviteUrl } from './inviteUrl';

export default function RoomCode({ code, invite = false }: { code: string; invite?: boolean }) {
  const [feedback, setFeedback] = useState("");
  const inviteUrl = invite && typeof window !== 'undefined' ? createInviteUrl(window.location.href, code) : '';
  async function copy(value: string, isInvite = false) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(isInvite ? "초대 링크를 복사했습니다." : "방 코드를 복사했습니다.");
    } catch {
      setFeedback(isInvite ? "복사할 수 없습니다. 아래 초대 링크를 직접 선택해 복사해주세요." : "복사할 수 없습니다. 방 코드를 직접 선택해 복사해주세요.");
    }
  }
  return <div className="online-room-code">
    <span>방 코드: <strong className="online-code" tabIndex={0}>{code}</strong></span>
    <button type="button" onClick={() => void copy(code)}>방 코드 복사</button>
    {invite && <>
      <button type="button" onClick={() => void copy(inviteUrl, true)}>초대 링크 복사</button>
      <label className="online-invite-field">초대 링크
        <input type="text" readOnly value={inviteUrl} aria-label="초대 링크" onFocus={event => event.currentTarget.select()} />
      </label>
    </>}
    {feedback && <small role="status">{feedback}</small>}
  </div>;
}
