import { useEffect, useState } from 'react';
import type { TurnTimerView } from '../../shared/online';

import { remainingSeconds } from "./countdown";

export default function TurnCountdown({ timer, name }: { timer: TurnTimerView; name: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);
  const seconds = remainingSeconds(timer, now);
  return <span className={`online-turn-timer${seconds <= 10 ? ' is-urgent' : ''}`} role="timer"
    aria-label={`${name}님 남은 시간 ${seconds}초`}>
    <span>{name}님 차례</span> <strong>{seconds}초</strong>
  </span>;
}
