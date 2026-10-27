import { MAX_CHAT_MESSAGE_LENGTH, NICKNAME_MAX_LENGTH } from '../shared/online';
import type { CreateRoomRequest, ReconnectSession, RematchRequest } from '../shared/online';

// Only these deliberate, user-facing failures may cross the socket boundary.
export class RequestError extends Error {}
export const REQUEST_FAILED = '요청 처리에 실패했습니다.';

export function validateChat(input: unknown) {
  const error = `올바른 방과 1~${MAX_CHAT_MESSAGE_LENGTH}자의 한 줄 메시지를 입력해주세요.`;
  const a = record(input, ['roomCode', 'message'], error);
  if (!validRoomCode(a.roomCode) || typeof a.message !== 'string' ||
    a.message.length > MAX_CHAT_MESSAGE_LENGTH || !a.message.trim() ||
    /[\p{Cc}\u200b\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u.test(a.message)) throw new RequestError(error);
  return { roomCode: a.roomCode, message: a.message.trim() };
}

export function record(input: unknown, keys: readonly string[], message: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new RequestError(message);
  }
  return input as Record<string, unknown>;
}

export function validRoomCode(input: unknown): input is string {
  return typeof input === 'string' && /^[A-Z0-9]{6}$/.test(input);
}
export function validCounter(input: unknown, minimum: number): input is number {
  return Number.isSafeInteger(input) && (input as number) >= minimum;
}
export function validateNickname(input: unknown) {
  if (typeof input !== 'string') throw new RequestError('닉네임을 입력해주세요.');
  const value = input.trim();
  if (!value || input.length > 1024 || value.length > NICKNAME_MAX_LENGTH || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new RequestError(`닉네임은 1~${NICKNAME_MAX_LENGTH}자이며 제어 문자를 사용할 수 없습니다.`);
  }
  return value;
}
export function validateReconnect(input: unknown): ReconnectSession {
  const message = '잘못된 재접속 요청입니다.';
  const a = record(input, ['roomCode', 'token'], message);
  if (!validRoomCode(a.roomCode) || typeof a.token !== 'string' || !/^[a-f0-9]{64}$/.test(a.token)) {
    throw new RequestError(message);
  }
  return { roomCode: a.roomCode, token: a.token };
}
export function validateRematch(input: unknown): RematchRequest {
  const message = '잘못된 다시하기 요청입니다.';
  const a = record(input, ['roomCode', 'round', 'ready'], message);
  if (!validRoomCode(a.roomCode) || !validCounter(a.round, 1) || typeof a.ready !== 'boolean') {
    throw new RequestError(message);
  }
  return { roomCode: a.roomCode, round: a.round, ready: a.ready };
}

export function validateCreateRoom(input: unknown): CreateRoomRequest {
  const message = '잘못된 방 생성 요청입니다.';
  const a = record(input, ['mode', 'nickname', 'visibility', 'beginnerHelpEnabled'], message);
  if (a.mode !== 'matgo' && a.mode !== 'gostop') throw new RequestError('지원하지 않는 게임 모드입니다.');
  if (a.visibility !== 'private' && a.visibility !== 'public') throw new RequestError('잘못된 방 공개 설정입니다.');
  if (a.beginnerHelpEnabled !== undefined && typeof a.beginnerHelpEnabled !== 'boolean') throw new RequestError(message);
  return { mode: a.mode, nickname: validateNickname(a.nickname), visibility: a.visibility, beginnerHelpEnabled: a.beginnerHelpEnabled ?? false };
}
