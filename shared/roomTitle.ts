import { ROOM_TITLE_MAX_LENGTH } from './online';

// Length follows JavaScript strings and HTML maxlength: UTF-16 code units.
export function roomTitleError(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 1024 || !input.trim() ||
    input.trim().length > ROOM_TITLE_MAX_LENGTH ||
    /[\p{Cc}\u200b\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u.test(input)) {
    return `방 제목은 앞뒤 공백 제거 후 1~${ROOM_TITLE_MAX_LENGTH}자이며 줄바꿈과 제어 문자를 사용할 수 없습니다.`;
  }
  return null;
}
