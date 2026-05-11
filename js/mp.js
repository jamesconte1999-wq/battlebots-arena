// MP: orchestrates the multiplayer flow.
//   start()  → connect → joinArena → route to arena screen, run input loop
//   stop()   → tear down loops, leave room
//
// Visual rendering of the arena from server snapshots is delegated to
// Arena.startMultiplayer(...). MP only owns input transmission, the
// status banner, scoreboard, and the result modal.

const MP = (() => {
  const INPUT_HZ = 30;
  let inputTimer = null;
  let lastInputSig = '';

  let state = null;            // colyseus state ref (latest)
  let mySessionId = '';
  let lastBanner = '';
  let lastPhase = '';
  let connecting = false;
  let resultShown = false;
  let lastLoadout = null;
  let lastName = '';

  // -----------------------------------------------------------------------
  function el(id) { return document.getElementById(id); }

  function showStatus(title, sub) {
    el('mp-status-title').textContent = title;
    el('mp-status-sub').textContent = sub || '';
    el('mp-status').classList.remove('hidden');
  }
  function hideStatus() {
    el('mp-status').classList.add('hidden');
  }

  function showOverlay() { el('mp-overlay').classList.remove('hidden'); }
  function hideOverlay() { el('mp-overlay').classList.add('hidden'); }

  function setBanner(text, kind = '') {
    if (text === lastBanner) return;
    lastBanner = text;
    const b = el('mp-banner');
    b.textContent = text;
    b.className = 'mp-banner' + (kind ? ' mp-banner-' + kind : '');
  }

  // -----------------------------------------------------------------------
  function init() {
    el('btn-quick-match').addEventListener('click', () => startFromTitle());
    el('btn-find-match').addEventListener('click', () => startFromBuilder());
    el('btn-mp-cancel').addEventListener('click', () => stop({ goTitle: true }));
    el('btn-mp-quit').addEventListener('click', () => stop({ goTitle: true }));
    el('btn-mp-leave').addEventListener('click', () => {
      el('mp-result-overlay').classList.add('hidden');
      stop({ goTitle: true });
    });
    el('btn-mp-rematch').addEventListener('click', () => {
      el('mp-result-overlay').classList.add('hidden');
      // Stay connected; server already cycles back to lobby/countdown.
      // Just clear the result-shown latch so a new one can fire.
      resultShown = false;
    });

    // Net listeners (idempotent — installed once).
    Net.on('state', (s) => onStateReady(s));
    Net.on('tick', () => onTick());
    Net.on('match-end', (p) => onMatchEnd(p));
    Net.on('leave', (info) => onLeave(info));
    Net.on('error', (e) => onError(e));
  }

  // -----------------------------------------------------------------------
  function startFromTitle() {
    const spec = (typeof Builder !== 'undefined' && Builder.getSpec)
      ? Builder.getSpec()
      : defaultSpec();
    return start(spec);
  }
  function startFromBuilder() {
    return start(Builder.getSpec());
  }

  function defaultSpec() {
    return {
      name: 'Wreckless',
      color: '#ff6a00', accent: '#ffffff', pattern: 'solid',
      chassis: 'brick', weapon: 'spinner',
      mods: [],
      stats: { armor: 4, speed: 4, power: 3, weight: 3 },
    };
  }

  async function start(spec) {
    if (connecting) return;
    connecting = true;
    resultShown = false;
    lastLoadout = spec;
    lastName = spec.name;

    Game.show('arena');
    showOverlay();
    showStatus('Connecting…', 'Reaching arena server.');
    setBanner('Connecting…');

    try {
      await Net.joinArena({
        name: spec.name,
        loadout: spec,
        token: (typeof Auth !== 'undefined' ? Auth.token() : ''),
      });
      mySessionId = Net.getSessionId();
      showStatus('Joining arena…', 'Waiting for state…');
    } catch (err) {
      console.error('[MP] join failed:', err);
      setBanner('Connection failed', 'bad');
      showStatus('Connection failed',
        err.message + ' — make sure the server is running on :2567');
      connecting = false;
      return;
    }
  }

  function onStateReady(s) {
    state = s;
    connecting = false;
    hideStatus();
    Arena.startMultiplayer({
      state,
      myId: mySessionId,
      onLeave: () => stop({ goTitle: true }),
    });
    startInputLoop();
    refreshFromState();
  }

  function onTick() {
    if (!state) return;
    refreshFromState();
  }

  function refreshFromState() {
    updateBanner();
    updateScoreboard();
    updateHpHud();
  }

  function updateBanner() {
    const phase = state.phase;
    const t = Math.max(0, Math.ceil(state.timer || 0));
    let text = '';
    let kind = '';
    if (phase === 'lobby') {
      const n = state.bots.size;
      text = n < 2
        ? `Waiting for opponents… (${n}/8) · Demo bots brawling`
        : `Filling arena… (${n}/8)`;
    } else if (phase === 'countdown') {
      text = `Match starts in ${t}…`;
      kind = 'count';
    } else if (phase === 'active') {
      const aliveCount = aliveBots().length;
      text = `FFA · ${formatTime(t)} · ${aliveCount} alive`;
    } else if (phase === 'result') {
      const w = state.bots.get(state.winnerId);
      text = w ? `Winner: ${w.name}` : 'Draw';
      kind = 'result';
    }
    setBanner(text, kind);

    if (phase !== lastPhase) {
      lastPhase = phase;
      if (phase === 'active') resultShown = false;
    }
  }

  function aliveBots() {
    const out = [];
    state.bots.forEach(b => { if (!b.dead) out.push(b); });
    return out;
  }

  function formatTime(secs) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function updateScoreboard() {
    const arr = [];
    state.bots.forEach(b => arr.push(b));
    arr.sort((a, b) => (b.score - a.score) || (b.kills - a.kills) || (b.hp - a.hp));
    const html = arr.map(b => {
      const me = b.id === mySessionId ? ' me' : '';
      const dead = b.dead ? ' dead' : '';
      const hpPct = Math.max(0, Math.min(100, (b.hp / b.maxHp) * 100));
      return `<div class="sb-row${me}${dead}">
        <span class="sb-name">${escapeHtml(b.name || '???')}</span>
        <span class="sb-hp"><span class="sb-hp-fill" style="width:${hpPct}%"></span></span>
        <span class="sb-k">${b.kills | 0}K</span>
        <span class="sb-score">${b.score | 0}</span>
      </div>`;
    }).join('');
    el('mp-scoreboard').innerHTML = html;
  }

  function updateHpHud() {
    // Re-purpose the existing arena topbar HUD for our bot + leader.
    const me = state.bots.get(mySessionId);
    if (me) {
      const root = el('hud-player');
      root.querySelector('.hud-name').textContent = me.name;
      const fill = root.querySelector('.hud-fill');
      const pct = Math.max(0, me.hp / me.maxHp);
      fill.style.width = (pct * 100).toFixed(1) + '%';
      fill.classList.toggle('low', pct < 0.35);
    }
    // Right HUD: top opponent (highest score among non-self alive)
    let top = null;
    state.bots.forEach(b => {
      if (b.id === mySessionId) return;
      if (!top || b.score > top.score || (b.score === top.score && b.hp > top.hp)) top = b;
    });
    const right = el('hud-enemy');
    if (top) {
      right.classList.remove('hidden');
      right.querySelector('.hud-name').textContent = top.name;
      const f = right.querySelector('.hud-fill');
      const pct = Math.max(0, top.hp / top.maxHp);
      f.style.width = (pct * 100).toFixed(1) + '%';
      f.classList.toggle('low', pct < 0.35);
    } else {
      right.classList.add('hidden');
    }
    el('match-timer').textContent = Math.max(0, Math.ceil(state.timer || 0));
  }

  // -----------------------------------------------------------------------
  function startInputLoop() {
    if (inputTimer) clearInterval(inputTimer);
    inputTimer = setInterval(tickInput, 1000 / INPUT_HZ);
  }
  function stopInputLoop() {
    if (inputTimer) { clearInterval(inputTimer); inputTimer = null; }
  }
  function tickInput() {
    if (!state) return;
    const inp = Arena.computeInput();
    const sig = inp.throttle + ',' + inp.turn + ',' + (inp.fire ? 1 : 0);
    // Always send when fire flips; otherwise rate-limit identical states
    // by requiring a small change. Server treats stale input as zero soon.
    if (sig === lastInputSig && Math.random() > 0.2) return;
    lastInputSig = sig;
    Net.sendInput(inp);
  }

  // -----------------------------------------------------------------------
  function onMatchEnd(payload) {
    if (resultShown) return;
    resultShown = true;
    const winner = state.bots.get(payload.winnerId);
    const won = payload.winnerId === mySessionId;
    el('mp-result-title').textContent =
      won ? 'VICTORY!' :
      payload.winnerId ? `${winner ? winner.name : '???'} wins` : 'DRAW';
    el('mp-result-sub').textContent =
      won ? 'You crushed the arena. Stats updated.' :
            'Better luck next round. Re-enter to retry.';
    // Leaderboard view of final standings.
    const arr = [];
    state.bots.forEach(b => arr.push(b));
    arr.sort((a, b) => (b.score - a.score) || (b.kills - a.kills));
    el('mp-result-board').innerHTML = arr.map((b, i) => {
      const me = b.id === mySessionId ? ' me' : '';
      const win = b.id === payload.winnerId ? ' winner' : '';
      return `<div class="mp-result-row${me}${win}">
        <span class="rr-rank">#${i + 1}</span>
        <span class="rr-name">${escapeHtml(b.name)}</span>
        <span class="rr-score">${b.score | 0}</span>
        <span class="rr-k">${b.kills | 0}K</span>
      </div>`;
    }).join('');
    el('mp-result-overlay').classList.remove('hidden');

    // Refresh local economy + ladder cache asynchronously.
    if (typeof Auth !== 'undefined' && Auth.isSignedIn()) {
      Auth.me().catch(() => {});
    }
  }

  function onLeave(info) {
    stopInputLoop();
    Arena.stopMultiplayer();
    state = null;
    mySessionId = '';
    if (info && info.code !== 1000 && info.code !== 4000) {
      // Unexpected drop
      showStatus('Disconnected', 'Connection to the arena was lost.');
    }
  }

  function onError(e) {
    console.warn('[MP] room error', e);
    showStatus('Server error', e.msg || 'Connection error');
  }

  // -----------------------------------------------------------------------
  async function stop({ goTitle = false } = {}) {
    stopInputLoop();
    Arena.stopMultiplayer();
    hideOverlay();
    hideStatus();
    el('mp-result-overlay').classList.add('hidden');
    state = null;
    mySessionId = '';
    lastBanner = '';
    lastPhase = '';
    connecting = false;
    resultShown = false;
    el('hud-enemy').classList.remove('hidden');
    try { await Net.leave(); } catch (_) {}
    if (goTitle) Game.show('title');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  return { init, start, stop };
})();
