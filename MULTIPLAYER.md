# Multiplayer Roadmap

This is the plan for taking ArenaBots.io from a single-player tournament to
a real online competitive game with progression. The server lives in a
sibling repo: `../arenabots-server/`.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Server scaffold (Node + Colyseus + SQLite + auth) | ✅ done |
| 2 | Authoritative arena simulation on the server | ✅ done (basic) |
| 3 | Client `RemoteController` + Colyseus SDK | ⬜ next |
| 4 | Login / Signup screens, JWT in client | ⬜ next |
| 5 | Persistent XP/level/ladder hooked to match outcomes | ⬜ next |
| 6 | Lobby & matchmaking UI | ⬜ next |
| 7 | Deployment (Render + Netlify) | ⬜ later |
| 8 | Anti-cheat hardening, region servers, voice | ⬜ later |

## Architecture

```
┌────────────────────┐                 ┌──────────────────────┐
│ arenabots-arena    │  HTTPS (REST)   │  arenabots-server    │
│ (static client)    │ ──────────────▶ │  /api/signup, login   │
│ - HTML/CSS/JS      │                 │  /api/ladder, /me     │
│ - PIXI/Canvas      │                 │                      │
│ - Local Store +    │  WSS (Colyseus) │  Colyseus rooms      │
│   Builder + Arena  │ ◀══════════════▶│  - ArenaRoom         │
└────────────────────┘   delta state   │    (authoritative    │
                          + inputs     │     simulation)      │
                                       │                      │
                                       │  SQLite (accounts,   │
                                       │   stats, ladder)     │
                                       └──────────────────────┘
```

The client renders, sends **inputs only** (`throttle`, `turn`, `fire`), and
receives authoritative state snapshots. Cosmetic data (paint pattern, accent
color) is passed once at join time and synced.

## Phase 3 — client integration plan

### a) Add the SDK

`index.html` adds:

```html
<script src="https://unpkg.com/colyseus.js@^0.15/dist/colyseus.js"></script>
```

### b) New `js/net.js` module

```
const Net = (() => {
  let client, room;
  async function connect(url, options) {
    client = new Colyseus.Client(url);
    room = await client.joinOrCreate('arena_ffa', options);
    room.onStateChange(state => Game.onSnapshot(state));
    room.onMessage('match-end', payload => Game.onMatchEnd(payload));
    return room;
  }
  function sendInput(input) { if (room) room.send('input', input); }
  function leave() { if (room) room.leave(); room = null; }
  return { connect, sendInput, leave };
})();
```

### c) New `RemoteController`

In `js/bot.js`, add a controller class that does **nothing** — the server
owns the bot. The client just renders the snapshot positions.

The local player's input is sent via `Net.sendInput()` instead of being
applied locally. **Client prediction** can be added later by interpolating
between snapshots.

### d) Arena.js — two modes

Refactor `Arena.start()` to accept a `mode`:

```
Arena.start({ mode: 'singleplayer', playerSpec, enemySpec, ... });
Arena.start({ mode: 'multiplayer', room });
```

In multiplayer mode, the render loop reads `room.state.bots` instead of
local `bots`, and skips physics entirely.

### e) Title-screen entry point

Add a **Quick Match** button on the title screen. Click → connect → wait
in lobby → match starts when 2+ players are present.

## Phase 4 — auth UI

Two new screens / overlays:

- **Sign up**: username, password, displayName. Posts to `/api/signup`.
- **Log in**: username, password. Posts to `/api/login`.

Stores the returned JWT in `localStorage` under `arenabots_token`. Net
connection passes `{ token }` in `joinOrCreate` options; server-side we
extend `ArenaRoom.onAuth` to verify.

If no token, the client connects anonymously and stats don't persist.

## Phase 5 — progression hooks

Server's `ArenaRoom.toResult(winnerId)` callback:

- Update `stats` row for each authenticated player:
  - `+25 xp` per kill, `+150 xp` for victory, `-15 xp` for loss
  - Leveling curve: `xp_for_level(n) = 100 * n^1.5`
  - `rank_points`: ELO-style based on opponent ranks
  - Streak tracking
- Broadcast `progression` message with deltas so the client can show
  level-up animations.

## Phase 6 — lobby UI

Replace the singleplayer "Enter Arena" path with a quickmatch lobby:

- Show waiting players in the room with their bot loadouts.
- Pre-match countdown synced to `state.timer`.
- Post-match scoreboard with kills, score, XP earned, rank delta.

## Phase 7 — deployment

| Component | Host | Cost |
|---|---|---|
| Static client | Netlify / Cloudflare Pages | Free |
| Game server | Render Starter | ~$7/mo |
| Database | SQLite on Render persistent disk | included |

Steps:

1. Push `arenabots-server/` to GitHub.
2. Create Render Blueprint deployment from the included `render.yaml`.
3. Set `ALLOWED_ORIGINS` to your frontend domain.
4. Deploy `arenabots-arena/` to Netlify.
5. In `js/net.js`, set `WS_URL = 'wss://your-service.onrender.com'`.

## Phase 8 — hardening (later)

- Per-IP rate limiting on signup/login.
- Per-room reservation tokens to prevent session-id spoofing.
- Region-aware matchmaking (US-East, EU, AP).
- Replay system (record state snapshots, replay client-side).
- Voice via WebRTC (mediasoup or LiveKit).
- Anti-AFK kick.
- Spectator mode (already free with Colyseus join-as-spectator option).

## Key design decisions

- **Inputs-only protocol**: clients can never lie about position. Lag-compensation
  via interpolation, not extrapolation, to avoid position rubber-banding.
- **Schema-based diffs over WebSocket**: Colyseus only sends changed fields,
  keeping bandwidth ~1-2 KB/s per player even during chaos.
- **One-binary deploy**: Express and Colyseus share a port to keep ops simple.
- **SQLite + WAL**: enough for tens of thousands of accounts; switch to
  Postgres only if metrics warrant.
