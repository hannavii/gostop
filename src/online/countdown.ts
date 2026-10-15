import type { TurnTimerView } from "../../shared/online";

export const remainingSeconds = (timer: TurnTimerView, now: number) =>
  Math.max(0, Math.ceil((timer.turnDeadline - Math.max(timer.startsAt, now)) / 1000));

