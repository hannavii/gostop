import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_CHAT_MESSAGE_LENGTH, type ChatState, type Reply } from '../../shared/online';
import { QUICK_CHAT_PRESETS } from './quickChat';

export type RoomChatProps = { roomCode: string | null; state: ChatState | null; enabled: boolean; send: (message: string) => Promise<Reply> };

function ChatPanel({ state, enabled, send }: Omit<RoomChatProps, 'roomCode'>) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [read, setRead] = useState<string | null>(() => state?.messages.at(-1)?.id ?? null);
  const messages = state?.messages ?? [];
  const latest = messages.at(-1)?.id ?? null;
  const unread = open || !messages.length || latest === read ? 0
    : read === null ? messages.length : messages.findIndex(m => m.id === read) < 0 ? messages.length
    : messages.length - messages.findIndex(m => m.id === read) - 1;
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const sending = useRef(false);
  useLayoutEffect(() => {
    if (open && nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [open, latest]);
  async function submit(message: string, clearDraft = false) {
    if (sending.current || !enabled || !message.trim()) return;
    sending.current = true;
    setBusy(true); setError('');
    try {
      const reply = await send(message);
      if (reply.ok) { if (clearDraft) setText(''); nearBottom.current = true; }
      else setError(reply.error);
    } catch { setError('전송을 확인하지 못했습니다. 중복 전송에 주의해 다시 시도해주세요.'); }
    finally { sending.current = false; setBusy(false); }
  }
  return <aside className="room-chat" aria-label="방 채팅" data-open={open}>
    <button className="room-chat-toggle" type="button" aria-expanded={open} aria-controls="room-chat-panel" onClick={() => {
      setOpen(!open); setRead(latest); nearBottom.current = true;
    }}>{open ? '채팅 닫기' : `채팅${unread ? ` (${unread})` : ''}`}</button>
    {open && <section id="room-chat-panel" className="room-chat-panel">
      <div className="room-chat-quick" role="group" aria-label="빠른 채팅">
        {QUICK_CHAT_PRESETS.map(preset => <button key={preset.text} type="button"
          aria-label={preset.label} disabled={!enabled || busy}
          onClick={() => void submit(preset.text)}>{preset.text}</button>)}
      </div>
      <div className="room-chat-messages" ref={scroll} aria-label="채팅 메시지" tabIndex={0} onScroll={e => {
        const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}>
        <ol>{messages.map(message => <li key={message.id} className={`chat-${message.type}`} data-message-id={message.id}>
          <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>{' '}
          {message.type === 'user' && <strong>{message.sender.nickname}{message.sender.role === 'spectator' ? ' [관전]' : ''}: </strong>}
          <span>{message.type === 'system' ? '• ' : ''}{message.text}</span>
        </li>)}</ol>
      </div>
      <form onSubmit={e => { e.preventDefault(); void submit(text, true); }}>
        <label className="room-chat-label" htmlFor="room-chat-input">메시지 (한 줄, Enter로 전송)</label>
        <div className="room-chat-compose">
          <input id="room-chat-input" value={text} maxLength={MAX_CHAT_MESSAGE_LENGTH} autoComplete="off" disabled={!enabled || busy}
            onChange={e => setText(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
            }} />
          <button type="submit" disabled={!enabled || busy || !text.trim()}>전송</button>
        </div>
      </form>
      {!enabled && <p>연결 복구 후 채팅할 수 있습니다.</p>}
      {error && <p role="status">{error}</p>}
    </section>}
  </aside>;
}

// The chat occupies its own region so hands, timer and decision overlays stay operable.
export default function RoomChatLayout({ children, ...props }: RoomChatProps & { children: ReactNode }) {
  if (!props.roomCode) return <>{children}</>;
  return <div className="online-room-layout">
    <div className="online-room-content">{children}</div>
    <ChatPanel key={props.roomCode} state={props.state?.roomCode === props.roomCode ? props.state : null} enabled={props.enabled} send={props.send} />
  </div>;
}
