import { randomUUID } from 'node:crypto';
import { MAX_CHAT_HISTORY, type ChatMessage, type ChatSender } from '../shared/online';

// A Room owns this history. No Match, credentials or transport objects are retained.
export class RoomChat {
  messages: ChatMessage[] = [];
  private add(message: ChatMessage) {
    this.messages.push(message);
    if (this.messages.length > MAX_CHAT_HISTORY) this.messages.splice(0, this.messages.length - MAX_CHAT_HISTORY);
  }
  user(sender: ChatSender, text: string) {
    this.add({ id: randomUUID(), createdAt: new Date().toISOString(), type: 'user', sender: { ...sender }, text });
  }
  system(nickname: string, event: Extract<ChatMessage, { type: 'system' }>['event']) {
    const suffix = { join: '님이 입장했습니다.', leave: '님이 퇴장했습니다.', disconnect: '님의 연결이 끊겼습니다.', reconnect: '님이 다시 연결되었습니다.' };
    this.add({ id: randomUUID(), createdAt: new Date().toISOString(), type: 'system', event, text: nickname + suffix[event] });
  }
}
