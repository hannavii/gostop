export const INVALID_INVITE_MESSAGE = '초대 링크의 방 코드가 올바르지 않습니다. 6자리 영문·숫자를 확인해주세요.';

export function normalizeInviteCode(value: string): string | null {
  const code = value.trim();
  return /^[a-z0-9]{6}$/i.test(code) ? code.toUpperCase() : null;
}

export function readRoomInvite(search: string): { present: boolean; code: string | null } {
  const values = new URLSearchParams(search).getAll('room');
  return { present: values.length > 0, code: values.length === 1 ? normalizeInviteCode(values[0]) : null };
}

export function createInviteUrl(href: string, roomCode: string): string {
  const code = normalizeInviteCode(roomCode);
  if (!code) throw new Error('Invalid invite room code');
  const current = new URL(href);
  // Start from origin/path only: never copy credentials, other query parameters or a hash.
  const invite = new URL(current.origin);
  invite.pathname = current.pathname;
  invite.searchParams.set('room', code);
  return invite.href;
}

export function withoutRoomInvite(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('room');
  return url.href;
}

export function clearRoomInvite() {
  if (!new URLSearchParams(window.location.search).has('room')) return;
  try {
    window.history.replaceState(window.history.state, '', withoutRoomInvite(window.location.href));
  } catch { /* History restrictions must never interfere with joining or resuming. */ }
}
