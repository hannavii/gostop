import { useLayoutEffect, useRef } from 'react';

// Presentation coordinates only; turn decisions and animation timing stay in the games.
export function useAiLayoutAnchors(started: boolean, activeOpponent = 1) {
  const boardRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      if (!window.matchMedia('(max-width: 700px)').matches) return;
      const anchor = (name: string, selector: string, clip?: string) => {
        const element = board.querySelector(selector);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const bounds = clip ? board.querySelector(clip)?.getBoundingClientRect() : undefined;
        const top = bounds ? Math.max(rect.top, bounds.top) : rect.top;
        const bottom = bounds ? Math.min(rect.bottom, bounds.bottom) : rect.bottom;
        board.style.setProperty(`--ai-${name}-x`, `${rect.left + rect.width / 2}px`);
        board.style.setProperty(`--ai-${name}-y`, `${(top + Math.max(top, bottom)) / 2}px`);
      };
      anchor('hand', '.player-area .card-row');
      anchor('opponent', board.classList.contains('gostop3-game')
        ? `.gostop3-opponent-zone:nth-child(${Math.max(1, activeOpponent)}) .card-row` : '.opponent-area .card-row');
      anchor('floor', '.floor-cards', '.table');
      anchor('draw', '.draw-pile-area .card-back');
      anchor('capture-player', '.captured-panel--right, .gostop3-captured-panel--player');
      anchor('capture-opponent', '.captured-panel--left');
      anchor('capture-opponent1', '.gostop3-captured-panel--opponent1');
      anchor('capture-opponent2', '.gostop3-captured-panel--opponent2');
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    board.querySelectorAll('.card-row, .floor-cards, .table, .captured-panel').forEach(element => observer.observe(element));
    window.addEventListener('resize', measure);
    board.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      board.removeEventListener('scroll', measure, true);
    };
  }, [started, activeOpponent]);
  return boardRef;
}
