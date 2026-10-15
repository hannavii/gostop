// Presentation only. Reaching zero never closes a room or advances a turn.
export const reconnectSeconds = (deadline: number, now: number) =>
  Math.max(0, Math.ceil((deadline - now) / 1000));
