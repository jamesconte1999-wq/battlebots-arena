// Arena: floor, hazards, physics, render loop, match state.

const Arena = (() => {
  const W = 900, H = 560;
  const WALL = 18;

  // Hazards definitions ------------------------------------------------------
  const HAZARDS = {
    // Pit in arena floor: instant KO if center over pit (hover ignores)
    pit: { x: W / 2, y: H / 2, w: 110, h: 70 },
    // Spinning saw blades
    saws: [
      { x: 130, y: 110, r: 26, ang: 0, spin: 6, dmg: 14 },
      { x: W - 130, y: H - 110, r: 26, ang: 0, spin: -6, dmg: 14 },
    ],
    // Spike strip — DoT zone, hover ignores
    spikes: { x: 60, y: H / 2 - 90, w: 18, h: 180, dmg: 12 }, // dps
  };

  let canvas, ctx;
  let bots = [];
  let player, enemy, playerCtrl, enemyCtrl;
  let inputState = { keys: {} };
  let running = false;
  let paused = false;
  let lastT = 0;
  let timer = 60;
  let particles = [];
  let onEnd = null;
  let hitMap = new Map();   // saw -> bot -> last damage time

  // Multiplayer mode state ---------------------------------------------------
  let mpMode = false;
  let mpState = null;       // Colyseus ArenaState reference
  let mpMyId = '';
  let mpGhosts = new Map(); // sessionId -> client-side ghost Bot
  let mpHooks = null;

  function init() {
    canvas = document.getElementById('arena-canvas');
    ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
  }

  function onKey(e) {
    if (!e.key) return;
    const k = e.key.toLowerCase();
    if (e.type === 'keydown') {
      inputState.keys[k] = true;
      if (k === 'p' && running) { e.preventDefault(); setPaused(!paused); }
      // prevent scroll on space/arrows during play
      if (running && [' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    } else {
      inputState.keys[k] = false;
    }
  }

  // Public: start a match given player + enemy specs.
  function start(playerSpec, enemySpec, roundIndex, totalRounds, finishedCb) {
    mpMode = false;
    mpGhosts.clear();
    mpState = null;
    player = new Bot(playerSpec, true);
    enemy = new Bot(enemySpec, false);
    bots = [player, enemy];

    // Spawn positions
    player.x = WALL + 90; player.y = H / 2; player.angle = 0;
    enemy.x = W - WALL - 90; enemy.y = H / 2; enemy.angle = Math.PI;

    playerCtrl = new PlayerController(inputState);
    enemyCtrl = new AIController(player);

    timer = 60;
    paused = false;
    running = true;
    particles = [];
    hitMap.clear();
    lastT = performance.now() / 1000;
    onEnd = finishedCb;

    document.getElementById('round-label').textContent = `ROUND ${roundIndex} / ${totalRounds}`;
    updateHud();
    applyWeaponUI();
    requestAnimationFrame(loop);
  }

  function setPaused(p) {
    paused = p;
    document.getElementById('pause-overlay').classList.toggle('hidden', !p);
    if (!p) lastT = performance.now() / 1000;
  }
  function stop() {
    running = false;
    mpMode = false;
    setPaused(false);
  }

  function loop(ts) {
    if (!running) return;
    const t = ts / 1000;
    let dt = Math.min(0.04, t - lastT);
    lastT = t;

    if (mpMode) {
      if (!paused) mpStep(dt);
      mpRender();
    } else {
      if (!paused) {
        step(dt);
        timer -= dt;
        if (timer <= 0) {
          timer = 0;
          endMatch(timeoutWinner());
          return;
        }
      }
      render();
    }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------------
  // Multiplayer mode: server-authoritative rendering
  // ---------------------------------------------------------------------------
  function startMultiplayer({ state, myId, onLeave }) {
    mpMode = true;
    mpState = state;
    mpMyId = myId || '';
    mpHooks = { onLeave: onLeave || null };
    mpGhosts.clear();
    bots = [];
    particles = [];
    hitMap.clear();
    paused = false;
    running = true;
    lastT = performance.now() / 1000;
    document.getElementById('round-label').textContent = 'MULTIPLAYER · FFA';
    requestAnimationFrame(loop);
  }

  function stopMultiplayer() {
    if (!mpMode) return;
    mpMode = false;
    mpState = null;
    mpMyId = '';
    mpGhosts.clear();
    bots = [];
    running = false;
    _lastWeaponType = null;
  }

  function mpStep(dt) {
    if (!mpState || !mpState.bots) return;
    const seen = new Set();
    mpState.bots.forEach((bs, id) => {
      seen.add(id);
      let g = mpGhosts.get(id);
      if (!g || g.spec.chassis !== bs.chassis || g.spec.weapon !== bs.weapon) {
        const spec = {
          name:    bs.name || 'BOT',
          color:   bs.color   || '#ff6a00',
          accent:  bs.accent  || '#ffffff',
          pattern: bs.pattern || 'solid',
          chassis: bs.chassis || 'brick',
          weapon:  bs.weapon  || 'spinner',
          mods:    [],
          stats:   { armor: 4, speed: 4, power: 3, weight: 3 },
        };
        g = new Bot(spec, id === mpMyId);
        mpGhosts.set(id, g);
        if (id === mpMyId) applyWeaponUI();
      }
      // Snap pose / hp from server.
      g.spec.name = bs.name;
      g.x = bs.x; g.y = bs.y; g.angle = bs.angle;
      const prevHp = g.hp;
      g.hp = bs.hp; g.maxHp = bs.maxHp;
      if (g.hp < prevHp) g.flashT = 0.12;
      g.dead = bs.dead;

      // Sync visual weapon phase. On phase transitions, reset the
      // local phase timer so the local visualizer plays the right
      // animation length.
      if (g.weaponPhase !== bs.weaponPhase) {
        g.weaponPhase = bs.weaponPhase;
        if (bs.weaponPhase === 'windup')      g.weaponPhaseT = g.weapon.windup || 0.2;
        else if (bs.weaponPhase === 'active') g.weaponPhaseT = g.weapon.active || 0.3;
        else                                  g.weaponPhaseT = 0;
      } else {
        g.weaponPhaseT = Math.max(0, g.weaponPhaseT - dt);
      }
      // Passive weapons — keep blade visually spinning.
      if (g.weapon.type === 'passive') {
        g.weaponSpinT = (g.weaponSpinT || 0) + (g.weapon.drawSpin || 24) * dt;
      }
      if (g.flashT > 0) g.flashT -= dt;
    });
    // Drop ghosts whose bots left the room.
    mpGhosts.forEach((_g, id) => { if (!seen.has(id)) mpGhosts.delete(id); });

    // Visual saw spin (rendered server-side too but we still want it animated).
    for (const s of HAZARDS.saws) s.ang += s.spin * dt;

    // Particle decay (impacts are local, see spawnSpark)
    particles = particles.filter(p => (p.life -= dt) > 0);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92;     p.vy *= 0.92;
    }
  }

  function mpRender() {
    // Floor + grid
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#10141c';
    ctx.lineWidth = 1;
    for (let x = WALL; x < W - WALL; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, WALL); ctx.lineTo(x, H - WALL); ctx.stroke();
    }
    for (let y = WALL; y < H - WALL; y += 32) {
      ctx.beginPath(); ctx.moveTo(WALL, y); ctx.lineTo(W - WALL, y); ctx.stroke();
    }
    drawPit();
    drawSpikes();
    mpGhosts.forEach(g => { if (!g.dead) { g.draw(ctx); drawNametag(ctx, g); } });
    for (const s of HAZARDS.saws) drawSaw(s);
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = `rgba(255,210,63,${a})`;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    drawWalls();
  }

  // Compute current input vector from the live key map. Used by mp.js
  // to send inputs at a fixed rate to the server.
  function computeInput() {
    const k = inputState.keys;
    let throttle = 0, turn = 0;
    if (k['w'] || k['arrowup'])    throttle += 1;
    if (k['s'] || k['arrowdown'])  throttle -= 1;
    if (k['a'] || k['arrowleft'])  turn -= 1;
    if (k['d'] || k['arrowright']) turn += 1;
    let fire = !!(k[' '] || k['space']);

    // Analog touch override for multiplayer input.
    if (typeof Touch !== 'undefined' && Touch.isEnabled && Touch.isEnabled()) {
      const a = Touch.getAnalog();
      if (a.active) { throttle = a.throttle; turn = a.turn; }
      if (a.fire) fire = true;
    }
    return { throttle, turn, fire };
  }

  function timeoutWinner() {
    // Highest HP wins; tie = draw
    if (player.hp > enemy.hp) return 'player';
    if (enemy.hp > player.hp) return 'enemy';
    return 'draw';
  }

  // ---------------------------------------------------------------------------
  // Weapon UI: tell the user whether their weapon needs the FIRE button or
  // damages on contact. Updates the desktop hint and the touch fire button.
  // ---------------------------------------------------------------------------
  function getPlayerWeaponType() {
    if (mpMode) {
      const me = mpMyId ? mpGhosts.get(mpMyId) : null;
      return (me && me.weapon && me.weapon.type) || null;
    }
    return (player && player.weapon && player.weapon.type) || null;
  }

  let _lastWeaponType = null;
  function applyWeaponUI() {
    const t = getPlayerWeaponType();
    if (t === _lastWeaponType) return;
    _lastWeaponType = t;

    document.body.classList.toggle('weapon-passive', t === 'passive');
    document.body.classList.toggle('weapon-active',  t === 'active');

    const hint = document.querySelector('.controls-hint');
    if (hint) {
      if (t === 'passive') {
        hint.innerHTML =
          '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · ' +
          'your weapon hits on contact — ram enemies · <kbd>P</kbd> pause';
      } else if (t === 'active') {
        hint.innerHTML =
          '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · ' +
          '<kbd>Space</kbd> trigger weapon · <kbd>P</kbd> pause';
      } else {
        hint.innerHTML =
          '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · ' +
          '<kbd>Space</kbd> weapon · <kbd>P</kbd> pause';
      }
    }

    const fireBtn = document.getElementById('tc-fire');
    if (fireBtn) {
      if (t === 'passive') {
        fireBtn.textContent = 'AUTO';
        fireBtn.classList.add('passive');
        fireBtn.title = 'Your weapon damages on contact — drive into enemies.';
      } else {
        fireBtn.textContent = 'FIRE';
        fireBtn.classList.remove('passive');
        fireBtn.title = 'Trigger your weapon';
      }
    }
  }

  function step(dt) {
    // Controllers
    playerCtrl.update(player, dt);
    enemyCtrl.update(enemy, dt, world());

    // Bot physics
    for (const b of bots) b.update(dt, world());

    // Wall collisions
    for (const b of bots) {
      if (b.dead) continue;
      if (b.x < WALL + b.radius) { b.x = WALL + b.radius; b.vx = Math.abs(b.vx) * 0.4; }
      if (b.x > W - WALL - b.radius) { b.x = W - WALL - b.radius; b.vx = -Math.abs(b.vx) * 0.4; }
      if (b.y < WALL + b.radius) { b.y = WALL + b.radius; b.vy = Math.abs(b.vy) * 0.4; }
      if (b.y > H - WALL - b.radius) { b.y = H - WALL - b.radius; b.vy = -Math.abs(b.vy) * 0.4; }
    }

    // Bot-bot collision (circle separation + impulse)
    for (let i = 0; i < bots.length; i++) {
      for (let j = i + 1; j < bots.length; j++) {
        const a = bots[i], b = bots[j];
        if (a.dead || b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = a.radius + b.radius;
        if (dist < minDist) {
          const nx = dx / dist, ny = dy / dist;
          const overlap = minDist - dist;
          const totalMass = a.mass + b.mass;
          a.x -= nx * overlap * (b.mass / totalMass);
          a.y -= ny * overlap * (b.mass / totalMass);
          b.x += nx * overlap * (a.mass / totalMass);
          b.y += ny * overlap * (a.mass / totalMass);
          // Mild push impulse
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const k = -rel * 0.4;
            a.vx -= nx * k * (b.mass / totalMass);
            a.vy -= ny * k * (b.mass / totalMass);
            b.vx += nx * k * (a.mass / totalMass);
            b.vy += ny * k * (a.mass / totalMass);
          }
          // Ram-spike damage on hard impacts (Ram Spikes mod)
          if (rel < -55) {
            if (a.ramDmg > 0) {
              b.takeHit(a.ramDmg, Math.atan2(b.y - a.y, b.x - a.x), 'weapon');
              spawnSpark(b.x, b.y, 4);
            }
            if (b.ramDmg > 0) {
              a.takeHit(b.ramDmg, Math.atan2(a.y - b.y, a.x - b.x), 'weapon');
              spawnSpark(a.x, a.y, 4);
            }
          }
        }
      }
    }

    // Passive weapon damage
    const now = performance.now() / 1000;
    for (const a of bots) {
      if (a.dead || a.weapon.type !== 'passive') continue;
      for (const b of bots) {
        if (b === a || b.dead) continue;
        const before = b.hp;
        a.tryPassiveHit(b, now);
        if (b.hp < before) spawnSpark(a.x + Math.cos(a.angle) * (a.radius + a.weapon.reach),
                                       a.y + Math.sin(a.angle) * (a.radius + a.weapon.reach));
      }
    }

    // Hazard: pit
    for (const b of bots) {
      if (b.dead || b.hover) continue;
      const p = HAZARDS.pit;
      if (b.x > p.x - p.w / 2 && b.x < p.x + p.w / 2 &&
          b.y > p.y - p.h / 2 && b.y < p.y + p.h / 2) {
        b.hp = 0; b.dead = true; b.deathReason = 'pit';
      }
    }

    // Hazard: saws
    for (const s of HAZARDS.saws) {
      s.ang += s.spin * dt;
      for (const b of bots) {
        if (b.dead) continue;
        const dx = b.x - s.x, dy = b.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d < s.r + b.radius) {
          const key = s.x + '_' + s.y + '_' + (b.isPlayer ? 'p' : 'e');
          const last = hitMap.get(key) || -999;
          if (now - last > 0.25) {
            hitMap.set(key, now);
            b.takeHit(s.dmg, Math.atan2(dy, dx), 'hazard');
            const k = 280;
            b.applyImpulse(dx / d * k, dy / d * k);
            spawnSpark(b.x, b.y);
          }
        }
      }
    }

    // Hazard: spikes (DoT)
    for (const b of bots) {
      if (b.dead || b.hover) continue;
      const sp = HAZARDS.spikes;
      if (b.x > sp.x && b.x < sp.x + sp.w + b.radius &&
          b.y > sp.y && b.y < sp.y + sp.h) {
        b.takeHit(sp.dmg * dt, null, 'hazard');
        if (Math.random() < 0.4) spawnSpark(b.x, b.y);
      }
    }

    // Particles
    particles = particles.filter(p => (p.life -= dt) > 0);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
    }

    updateHud();

    // Win check
    if (player.dead && enemy.dead) endMatch('draw');
    else if (player.dead) endMatch('enemy');
    else if (enemy.dead) endMatch('player');
  }

  function endMatch(winner) {
    if (!running) return;
    running = false;
    setTimeout(() => onEnd && onEnd(winner, { playerHp: player.hp, enemyHp: enemy.hp, timer }), 600);
  }

  function world() {
    return {
      bots,
      hazards: HAZARDS,
      spawnImpact: (x, y, kind) => spawnSpark(x, y, 14, kind),
    };
  }

  function spawnSpark(x, y, count = 6, kind = 'spark') {
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 280,
        vy: (Math.random() - 0.5) * 280,
        life: 0.25 + Math.random() * 0.25,
        max: 0.5,
        kind,
      });
    }
  }

  function updateHud() {
    setHud('hud-player', player);
    setHud('hud-enemy', enemy);
    document.getElementById('match-timer').textContent = Math.ceil(timer);
  }
  function setHud(id, b) {
    const el = document.getElementById(id);
    el.querySelector('.hud-name').textContent = b.spec.name;
    const fill = el.querySelector('.hud-fill');
    const pct = Math.max(0, b.hp / b.maxHp);
    fill.style.width = (pct * 100).toFixed(1) + '%';
    fill.classList.toggle('low', pct < 0.35);
  }

  // ---------- Rendering ----------
  function render() {
    // Floor
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, W, H);

    // Floor grid
    ctx.strokeStyle = '#10141c';
    ctx.lineWidth = 1;
    for (let x = WALL; x < W - WALL; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, WALL); ctx.lineTo(x, H - WALL); ctx.stroke();
    }
    for (let y = WALL; y < H - WALL; y += 32) {
      ctx.beginPath(); ctx.moveTo(WALL, y); ctx.lineTo(W - WALL, y); ctx.stroke();
    }

    // Hazards (under bots)
    drawPit();
    drawSpikes();

    // Bots
    for (const b of bots) if (!b.dead) {
      b.draw(ctx);
      drawNametag(ctx, b);
    }

    // Saws (over bots so they look threatening)
    for (const s of HAZARDS.saws) drawSaw(s);

    // Particles
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === 'flame') {
        ctx.fillStyle = `rgba(255,${120 + Math.floor(a * 100)},${Math.floor(a * 60)},${a})`;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      } else {
        ctx.fillStyle = `rgba(255,210,63,${a})`;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
    }

    // Walls
    drawWalls();
  }

  function drawNametag(ctx, b) {
    const name = (b.spec && b.spec.name) ? b.spec.name : 'BOT';
    const tagY = b.y - b.radius - 18;
    ctx.save();
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = 8;
    const padY = 4;
    const textW = ctx.measureText(name).width;
    const boxW = textW + padX * 2;
    const boxH = 14 + padY * 2;
    const x = b.x - boxW / 2;
    const y = tagY - boxH / 2;
    const r = 6;
    // Glow / shadow
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    // Background pill (draw rounded rect manually)
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + boxW - r, y);
    ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + r);
    ctx.lineTo(x + boxW, y + boxH - r);
    ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - r, y + boxH);
    ctx.lineTo(x + r, y + boxH);
    ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fillStyle = b.isPlayer ? 'rgba(255, 210, 63, 0.20)' : 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = b.isPlayer ? 'rgba(255, 210, 63, 0.90)' : 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Text
    ctx.fillStyle = b.isPlayer ? '#ffd23f' : '#ffffff';
    ctx.fillText(name, b.x, tagY);
    ctx.restore();
  }

  function drawWalls() {
    ctx.fillStyle = '#1d2330';
    ctx.fillRect(0, 0, W, WALL);
    ctx.fillRect(0, H - WALL, W, WALL);
    ctx.fillRect(0, 0, WALL, H);
    ctx.fillRect(W - WALL, 0, WALL, H);
    // hazard stripes
    ctx.fillStyle = '#ffd23f';
    const stripe = 14;
    for (let x = 0; x < W; x += stripe * 2) {
      ctx.fillRect(x, 0, stripe, 4);
      ctx.fillRect(x + stripe / 2, H - 4, stripe, 4);
    }
    for (let y = 0; y < H; y += stripe * 2) {
      ctx.fillRect(0, y, 4, stripe);
      ctx.fillRect(W - 4, y + stripe / 2, 4, stripe);
    }
  }

  function drawPit() {
    const p = HAZARDS.pit;
    ctx.save();
    ctx.translate(p.x, p.y);
    // dark hole
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, p.w / 2);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, '#0a0d13');
    ctx.fillStyle = grad;
    roundRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, 6);
    ctx.fill();
    // hazard border
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,210,63,0.6)';
    ctx.font = '700 11px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('PIT', 0, -p.h / 2 - 4);
    ctx.restore();
  }

  function drawSpikes() {
    const s = HAZARDS.spikes;
    ctx.fillStyle = '#3a4258';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = '#cfd6e2';
    for (let y = s.y + 4; y < s.y + s.h - 4; y += 10) {
      ctx.beginPath();
      ctx.moveTo(s.x + s.w, y);
      ctx.lineTo(s.x + s.w + 8, y + 4);
      ctx.lineTo(s.x + s.w, y + 8);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawSaw(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.ang);
    // disc
    ctx.fillStyle = '#cfd6e2';
    ctx.strokeStyle = '#0a0d13';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // teeth
    ctx.fillStyle = '#0a0d13';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x1 = Math.cos(a) * s.r;
      const y1 = Math.sin(a) * s.r;
      const x2 = Math.cos(a + 0.18) * (s.r + 5);
      const y2 = Math.sin(a + 0.18) * (s.r + 5);
      const x3 = Math.cos(a + 0.36) * s.r;
      const y3 = Math.sin(a + 0.36) * s.r;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  return {
    init, start, stop, setPaused,
    startMultiplayer, stopMultiplayer, computeInput,
    getPlayerWeaponType, applyWeaponUI,
  };
})();
