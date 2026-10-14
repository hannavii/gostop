import { createRoot, type Root } from 'react-dom/client';
import OnlineGameBoard from '../src/online/OnlineGameBoard';
import type { GameView, RoomView } from '../shared/online';
import '../src/App.css';
import '../src/online/online.css';

let root: Root | undefined;
let generation = 0;
export function mountLayoutFixture(game: GameView) {
  let element = document.getElementById('layout-fixture');
  if (!element) {
    element = document.createElement('div');
    element.id = 'layout-fixture';
    document.body.append(element);
    document.getElementById('root')!.style.display = 'none';
    root = createRoot(element);
  }
  const room: RoomView = { code: 'ABC123', mode: game.mode, capacity: game.players.length, occupancy: game.players.length,
    host: 0, you: 0, game, connections: game.players.map(player => ({ seat: player.seat,
      nickname: '모바일친구닉네임12', ready: true, connected: true, reconnectDeadline: null })) };
  const version = ++generation;
  root!.render(<div data-layout-generation={version} style={{ display: 'contents' }}><OnlineGameBoard key={version} room={room} game={game}
    enabled message="" act={(type, cardId) => { (window as unknown as { layoutAction: unknown }).layoutAction = { type, cardId }; }} onSync={() => {}} onLeave={() => {}} /></div>);
  return version;
}
export function unmountLayoutFixture() {
  root?.unmount();
  root = undefined;
  document.getElementById('layout-fixture')?.remove();
  document.getElementById('root')!.style.display = '';
}
