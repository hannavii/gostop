# Beginner help

`beginnerHelpEnabled` is an immutable server Room creation setting, independent of visibility and game mode. It defaults to false. Omitted values support legacy clients; non-booleans including null are rejected using existing strict validation. Public player and spectator projections include only this public setting. Reconnect, finished games and rematches preserve it.

Personal `helpVisible` is React state, initially OFF. It never sends a socket event or changes game revision, timer or another player's preference. A connection interruption preserves it while the board remains mounted; F5/restoring a remounted board and a new round reset it to OFF. No browser storage is used. Spectators receive neither the toggle nor the highlight calculation.

The UI uses the existing server-authoritative viewer-specific `canPlayHand` and the existing input locks (enabled, active connection, animation and special prompt). It reuses `findSameMonthCards` for public floor correspondence; both turn engines likewise construct same-month candidates. Existing engines retain all two-candidate choices, three-card captures and ppeok handling. Help shows correspondence, not a guaranteed or automatically selected capture.

All playable hand cards and corresponding floor cards are highlighted together, including grouped and expanded ppeok cards. This works immediately on touch devices without hover. A gold outline and subtle glow preserve geometry and hit areas. The toggle uses the existing wrapping toolbar.

Help is hidden during choose, GO/STOP, special prompts, action processing and presentation animation. Bomb passes obey server permission. Highlight sets are derived each render from the displayed public snapshot; flying cards never receive highlight props. No opponent hand, hidden deck, next draw, private pending state or extra legal action list is accessed or transmitted. Single-player behavior and game rules are unchanged.
