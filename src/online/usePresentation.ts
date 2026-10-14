import { useEffect, useState } from 'react';
import type { GameView, Seat } from '../../shared/online';
import { advancePresentation, displaySnapshot, receivePresentation, type PresentationState } from './presentation';

export function usePresentation(game: GameView, you: Seat) {
  const [state, setState] = useState<PresentationState>(() => ({ latest: game,
    frames: [{ game: displaySnapshot(game), visual: {}, duration: 0 }], index: 0 }));
  // Update before committing DOM: even the first render must not expose final locations.
  const current = receivePresentation(state, game, you);
  if (current !== state) setState(current);
  const frame = current.frames[current.index];
  useEffect(() => {
    if (!frame.duration) return;
    const timer = setTimeout(() => setState(old => advancePresentation(old, current.latest.revision)), frame.duration);
    return () => clearTimeout(timer);
  }, [frame, current.latest.revision]);
  return { ...frame, animating: current.index < current.frames.length - 1 };
}
