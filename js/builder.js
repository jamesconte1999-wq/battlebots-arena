// Bot builder: deep customization with tabs, mods, paint, pattern, radar.
// Exposes Builder.getSpec() for the rest of the game.

const Builder = (() => {
  const STATS = [
    { id: 'armor',  label: 'Armor',  desc: 'More HP' },
    { id: 'speed',  label: 'Speed',  desc: 'Acceleration & turn rate' },
    { id: 'power',  label: 'Power',  desc: 'Weapon damage multiplier' },
    { id: 'weight', label: 'Weight', desc: 'Mass — resists knockback' },
  ];

  // Defaults sum to STAT_POINTS + 4*STAT_MIN so the bar starts "full".
  const state = {
    name: 'Wreckless',
    color: CONFIG.colors[0],
    accent: CONFIG.accents[0],
    pattern: 'solid',
    chassis: 'brick',
    weapon: 'spinner',
    mods: [],
    stats: { armor: 4, speed: 4, power: 3, weight: 3 }, // sum 14 = STAT_POINTS
    activeTab: 'chassis',
  };

  let previewCtx, previewCanvas, previewBot, lastPreviewT;
  let radarCtx, radarCanvas;

  function init() {
    previewCanvas = document.getElementById('preview-canvas');
    previewCtx = previewCanvas.getContext('2d');
    radarCanvas = document.getElementById('radar-canvas');
    radarCtx = radarCanvas ? radarCanvas.getContext('2d') : null;

    renderColors();
    renderAccents();
    renderPatterns();
    renderTabs();
    renderActiveTab();
    renderPresets();
    rebuildPreview();

    document.getElementById('bot-name').addEventListener('input', e => {
      state.name = e.target.value || 'BOT';
    });

    document.getElementById('btn-save-preset').addEventListener('click', savePreset);
    document.getElementById('btn-load-preset').addEventListener('click', () => {
      document.getElementById('preset-dropdown').classList.toggle('hidden');
    });

    requestAnimationFrame(previewLoop);
  }

  // ---------- Presets --------------------------------------------------------
  const PRESET_KEY = 'battlebots_presets';

  function getPresets() {
    try {
      const stored = localStorage.getItem(PRESET_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }

  function savePresets(presets) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  }

  function savePreset() {
    const name = prompt('Enter preset name:');
    if (!name || !name.trim()) return;
    const presets = getPresets();
    presets[name.trim()] = getSpec();
    savePresets(presets);
    renderPresets();
    alert('Preset saved!');
  }

  function loadPreset(name) {
    const presets = getPresets();
    const preset = presets[name];
    if (!preset) return;
    
    state.name = preset.name;
    state.color = preset.color;
    state.accent = preset.accent;
    state.pattern = preset.pattern;
    state.chassis = preset.chassis;
    state.weapon = preset.weapon;
    state.mods = preset.mods || [];
    state.stats = preset.stats || { armor: 4, speed: 4, power: 3, weight: 3 };
    
    document.getElementById('bot-name').value = state.name;
    renderColors();
    renderAccents();
    renderPatterns();
    renderTabs();
    renderActiveTab();
    rebuildPreview();
    document.getElementById('preset-dropdown').classList.add('hidden');
  }

  function deletePreset(name) {
    if (!confirm(`Delete preset "${name}"?`)) return;
    const presets = getPresets();
    delete presets[name];
    savePresets(presets);
    renderPresets();
  }

  function renderPresets() {
    const presets = getPresets();
    const list = document.getElementById('preset-list');
    const dropdown = document.getElementById('preset-dropdown');
    
    if (!list || !dropdown) return;
    
    const names = Object.keys(presets);
    if (names.length === 0) {
      list.innerHTML = '<div class="preset-empty">No saved presets</div>';
      return;
    }
    
    list.innerHTML = names.map(name => `
      <div class="preset-item">
        <span class="preset-name">${escapeHtml(name)}</span>
        <div class="preset-actions">
          <button class="preset-btn preset-load" data-name="${escapeHtml(name)}">Load</button>
          <button class="preset-btn preset-delete" data-name="${escapeHtml(name)}">Delete</button>
        </div>
      </div>
    `).join('');
    
    list.querySelectorAll('.preset-load').forEach(btn => {
      btn.addEventListener('click', () => loadPreset(btn.dataset.name));
    });
    
    list.querySelectorAll('.preset-delete').forEach(btn => {
      btn.addEventListener('click', () => deletePreset(btn.dataset.name));
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Tabs ----------------------------------------------------------
  function renderTabs() {
    const tabs = [
      { id: 'chassis', label: 'Chassis' },
      { id: 'weapon',  label: 'Weapon' },
      { id: 'mods',    label: 'Mods' },
      { id: 'stats',   label: 'Stats' },
    ];
    const wrap = document.getElementById('builder-tabs');
    wrap.innerHTML = '';
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (state.activeTab === t.id ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => {
        state.activeTab = t.id;
        renderTabs();
        renderActiveTab();
      });
      wrap.appendChild(btn);
    }
  }

  function renderActiveTab() {
    const host = document.getElementById('tab-content');
    host.innerHTML = '';
    if (state.activeTab === 'chassis') renderChassis(host);
    else if (state.activeTab === 'weapon') renderWeapons(host);
    else if (state.activeTab === 'mods') renderMods(host);
    else if (state.activeTab === 'stats') renderStats(host);
  }

  // ---------- Paint ---------------------------------------------------------
  function renderColors() {
    const wrap = document.getElementById('color-swatches');
    wrap.innerHTML = '';
    const list = [
      ...CONFIG.colors.map(hex => ({ id: hex, hex, pro: false })),
      ...(CONFIG.proColors || []),
    ];
    list.forEach(c => {
      const locked = c.pro && !Store.isOwned('colors', c.id);
      const el = document.createElement('div');
      el.className = 'swatch'
        + (c.hex === state.color ? ' selected' : '')
        + (locked ? ' locked' : '')
        + (c.pro ? ' pro' : '');
      el.style.background = c.hex;
      el.title = c.name || c.hex;
      if (locked) el.innerHTML = '<span class="lock-mini">🔒</span>';
      el.addEventListener('click', () => {
        if (locked) {
          Shop.openUnlock('colors', c, () => {
            state.color = c.hex;
            renderColors();
            rebuildPreview();
          });
          return;
        }
        state.color = c.hex;
        renderColors();
        rebuildPreview();
      });
      wrap.appendChild(el);
    });
  }

  function renderAccents() {
    const wrap = document.getElementById('accent-swatches');
    wrap.innerHTML = '';
    CONFIG.accents.forEach(c => {
      const el = document.createElement('div');
      el.className = 'swatch swatch-sm' + (c === state.accent ? ' selected' : '');
      el.style.background = c;
      el.addEventListener('click', () => {
        state.accent = c;
        renderAccents();
        rebuildPreview();
      });
      wrap.appendChild(el);
    });
  }

  function renderPatterns() {
    const wrap = document.getElementById('pattern-list');
    wrap.innerHTML = '';
    CONFIG.patterns.forEach(p => {
      const locked = p.pro && !Store.isOwned('patterns', p.id);
      const el = document.createElement('button');
      el.className = 'pattern-btn'
        + (p.id === state.pattern ? ' selected' : '')
        + (locked ? ' locked' : '')
        + (p.pro ? ' pro' : '');
      el.innerHTML = (p.pro ? '<span class="lock-mini">' + (locked ? '🔒' : '★') + '</span> ' : '') + p.name;
      el.addEventListener('click', () => {
        if (locked) {
          Shop.openUnlock('patterns', p, () => {
            state.pattern = p.id;
            renderPatterns();
            rebuildPreview();
          });
          return;
        }
        state.pattern = p.id;
        renderPatterns();
        rebuildPreview();
      });
      wrap.appendChild(el);
    });
  }

  // ---------- Chassis tab ---------------------------------------------------
  function renderChassis(host) {
    host.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    CONFIG.chassis.forEach(c => {
      const locked = c.pro && !Store.isOwned('chassis', c.id);
      const card = document.createElement('div');
      card.className = 'card big-card'
        + (c.id === state.chassis ? ' selected' : '')
        + (locked ? ' locked' : '')
        + (c.pro ? ' pro-card' : '');
      card.innerHTML = `
        <div class="card-title">${c.name}<span class="card-tag${c.pro ? ' pro' : ''}">${c.tag}</span></div>
        <div class="card-desc">${c.desc}</div>
        ${locked ? renderLockBadge('chassis', c) : ''}
      `;
      card.addEventListener('click', () => {
        if (locked) {
          Shop.openUnlock('chassis', c, () => {
            state.chassis = c.id;
            renderChassis(host);
            rebuildPreview();
            updateRadar();
          });
          return;
        }
        state.chassis = c.id;
        renderChassis(host);
        rebuildPreview();
        updateRadar();
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  // ---------- Weapon tab ---------------------------------------------------
  function renderWeapons(host) {
    host.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    CONFIG.weapons.forEach(w => {
      const locked = w.pro && !Store.isOwned('weapons', w.id);
      const card = document.createElement('div');
      card.className = 'card big-card'
        + (w.id === state.weapon ? ' selected' : '')
        + (locked ? ' locked' : '')
        + (w.pro ? ' pro-card' : '');
      card.innerHTML = `
        <div class="card-title">${w.name}<span class="card-tag${w.pro ? ' pro' : ''}">${w.tag}</span></div>
        <div class="card-desc">${w.desc}</div>
        ${locked ? renderLockBadge('weapons', w) : ''}
      `;
      card.addEventListener('click', () => {
        if (locked) {
          Shop.openUnlock('weapons', w, () => {
            state.weapon = w.id;
            renderWeapons(host);
            rebuildPreview();
            updateRadar();
          });
          return;
        }
        state.weapon = w.id;
        renderWeapons(host);
        rebuildPreview();
        updateRadar();
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function renderLockBadge(category, item) {
    const price = Store.priceFor(category, item);
    if (!price) return '';
    return `<div class="lock-badge">🔒 ⚡ ${price.bolts} · ♛ ${price.crowns}</div>`;
  }

  // ---------- Mods tab -----------------------------------------------------
  function renderMods(host) {
    host.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'tab-header';
    header.innerHTML = `
      <div class="tab-header-info">Choose up to <b>${CONFIG.MAX_MODS}</b> mods.
        <span class="pts">${state.mods.length}/${CONFIG.MAX_MODS} equipped</span>
      </div>
    `;
    host.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'card-grid';
    CONFIG.mods.forEach(m => {
      const locked = m.pro && !Store.isOwned('mods', m.id);
      const equipped = state.mods.includes(m.id);
      const full = !equipped && state.mods.length >= CONFIG.MAX_MODS;
      const card = document.createElement('div');
      card.className = 'card big-card mod-card'
        + (equipped ? ' selected' : '')
        + (full && !locked ? ' disabled' : '')
        + (locked ? ' locked' : '')
        + (m.pro ? ' pro-card' : '');
      card.innerHTML = `
        <div class="card-title">${m.name}<span class="card-tag${m.pro ? ' pro' : ''}">${m.tag || 'Mod'}</span></div>
        <div class="card-desc">${m.desc}</div>
        <div class="mod-bonus">${describeBonus(m.bonus)}</div>
        ${locked ? renderLockBadge('mods', m) : ''}
      `;
      card.addEventListener('click', () => {
        if (locked) {
          Shop.openUnlock('mods', m, () => {
            if (state.mods.length < CONFIG.MAX_MODS) state.mods.push(m.id);
            renderMods(host);
            rebuildPreview();
            updateRadar();
          });
          return;
        }
        if (equipped) {
          state.mods = state.mods.filter(id => id !== m.id);
        } else if (state.mods.length < CONFIG.MAX_MODS) {
          state.mods.push(m.id);
        }
        renderMods(host);
        rebuildPreview();
        updateRadar();
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function describeBonus(b) {
    if (!b) return '';
    const parts = [];
    if (b.hp) parts.push(fmtSigned(b.hp) + ' HP');
    if (b.speed) parts.push(fmtPct(b.speed) + ' speed');
    if (b.turn) parts.push(fmtSigned(b.turn) + ' turn');
    if (b.mass) parts.push(fmtPct(b.mass) + ' mass');
    if (b.dmgMul) parts.push(fmtPct(b.dmgMul) + ' weapon dmg');
    if (b.deflect) parts.push('+' + Math.round(b.deflect * 100) + '% deflect');
    if (b.frontDeflect) parts.push('+' + Math.round(b.frontDeflect * 100) + '% front deflect');
    if (b.knockResist) parts.push('-' + Math.round(b.knockResist * 100) + '% knockback');
    if (b.ramDmg) parts.push('+' + b.ramDmg + ' ram dmg');
    if (b.regen) parts.push(fmtSigned(b.regen) + ' HP/s');
    if (b.magnet) parts.push('magnet ' + b.magnet + 'px');
    if (b.antiHazardDmg) parts.push('-' + Math.round(b.antiHazardDmg * 100) + '% hazard dmg');
    if (b.boost) parts.push('boost active');
    if (b.hover) parts.push('hovers');
    return parts.join(' · ');
  }
  function fmtSigned(n) { return (n >= 0 ? '+' : '') + n; }
  function fmtPct(n)    { return (n >= 0 ? '+' : '') + Math.round(n * 100) + '%'; }

  // ---------- Stats tab -----------------------------------------------------
  function renderStats(host) {
    host.innerHTML = '';
    const used = totalUsed();
    const left = CONFIG.STAT_POINTS - used;

    const header = document.createElement('div');
    header.className = 'tab-header';
    header.innerHTML = `
      <div class="tab-header-info">Allocate <b>${CONFIG.STAT_POINTS}</b> stat points.
        <span class="pts">${left} left</span>
      </div>
    `;
    host.appendChild(header);

    const list = document.createElement('div');
    list.className = 'stats-list';
    STATS.forEach(s => {
      const v = state.stats[s.id];
      const row = document.createElement('div');
      row.className = 'stat-row';
      const pct = (v / CONFIG.STAT_MAX) * 100;
      row.innerHTML = `
        <div class="stat-name" title="${s.desc}">${s.label}</div>
        <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
        <button class="stat-btn" data-act="dec" data-id="${s.id}" ${v <= CONFIG.STAT_MIN ? 'disabled' : ''}>−</button>
        <div class="stat-val">${v}</div>
        <button class="stat-btn" data-act="inc" data-id="${s.id}" ${v >= CONFIG.STAT_MAX || left <= 0 ? 'disabled' : ''}>+</button>
      `;
      list.appendChild(row);
    });
    host.appendChild(list);

    list.querySelectorAll('.stat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id, act = btn.dataset.act;
        const v = state.stats[id];
        if (act === 'inc' && v < CONFIG.STAT_MAX && totalUsed() < CONFIG.STAT_POINTS) state.stats[id]++;
        if (act === 'dec' && v > CONFIG.STAT_MIN) state.stats[id]--;
        renderStats(host);
        rebuildPreview();
        updateRadar();
      });
    });

    const summary = document.createElement('div');
    summary.className = 'stats-summary';
    const tmp = new Bot(getSpec(), true);
    summary.innerHTML = `
      <b>${tmp.maxHp.toFixed(0)} HP</b> ·
      top speed <b>${tmp.maxSpeed.toFixed(0)}</b> ·
      turn <b>${tmp.turnSpeed.toFixed(1)}</b> rad/s ·
      weapon dmg ×<b>${tmp.dmgMul.toFixed(2)}</b> ·
      mass <b>${tmp.mass.toFixed(2)}</b>
      ${tmp.deflect + tmp.frontDeflect > 0 ? ' · deflect <b>' + Math.round((tmp.deflect + tmp.frontDeflect) * 100) + '%</b>' : ''}
      ${tmp.knockResist > 0 ? ' · knock-resist <b>' + Math.round(tmp.knockResist * 100) + '%</b>' : ''}
      ${tmp.regen ? ' · regen <b>' + tmp.regen.toFixed(2) + ' HP/s</b>' : ''}
      ${tmp.magnetRange ? ' · magnet <b>' + tmp.magnetRange + ' px</b>' : ''}
      ${tmp.ramDmg ? ' · ram <b>+' + tmp.ramDmg + '</b>' : ''}
      ${tmp.hover ? ' · <b>hovers</b>' : ''}
      ${tmp.hasBoost ? ' · <b>boosters</b>' : ''}
    `;
    host.appendChild(summary);
  }

  function totalUsed() {
    return Object.values(state.stats).reduce((a, b) => a + b, 0) - STATS.length * CONFIG.STAT_MIN;
  }

  // ---------- Preview rendering --------------------------------------------
  function rebuildPreview() {
    previewBot = new Bot(getSpec(), true);
    previewBot.x = previewCanvas.width / 2;
    previewBot.y = previewCanvas.height / 2;
    previewBot.angle = 0;
    updateRadar();
  }

  function previewLoop(ts) {
    if (!previewCtx) return;
    const t = ts / 1000;
    const dt = lastPreviewT ? Math.min(0.05, t - lastPreviewT) : 0.016;
    lastPreviewT = t;

    if (previewBot) {
      previewBot.angle += 0.4 * dt;
      // Pulse-fire active weapons for preview drama.
      if (previewBot.weapon.type === 'active') {
        const pulse = (Math.floor(t * 0.7) % 3) === 0;
        previewBot.input.fire = pulse && previewBot.weaponPhase === 'idle';
      } else {
        previewBot.input.fire = false;
      }
      const stubWorld = { bots: [], spawnImpact() {} };
      previewBot.update(dt, stubWorld);
    }

    const ctx = previewCtx;
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.strokeStyle = '#161b25';
    ctx.lineWidth = 1;
    for (let x = 0; x < previewCanvas.width; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, previewCanvas.height); ctx.stroke();
    }
    for (let y = 0; y < previewCanvas.height; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(previewCanvas.width, y); ctx.stroke();
    }
    const cx = previewCanvas.width / 2, cy = previewCanvas.height / 2;
    const grad = ctx.createRadialGradient(cx, cy + 30, 8, cx, cy + 30, 110);
    grad.addColorStop(0, 'rgba(255,106,0,0.18)');
    grad.addColorStop(1, 'rgba(255,106,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    if (previewBot) previewBot.draw(ctx);

    ctx.fillStyle = '#e6ecf5';
    ctx.font = '700 14px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(state.name.toUpperCase(), cx, previewCanvas.height - 14);

    requestAnimationFrame(previewLoop);
  }

  // ---------- Radar chart ---------------------------------------------------
  function updateRadar() {
    if (!radarCtx) return;
    const tmp = new Bot(getSpec(), true);
    const W = radarCanvas.width, H = radarCanvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.4;

    // Normalized 0..1 for each axis vs reasonable max
    const axes = [
      { label: 'HP',     v: clampNorm(tmp.maxHp / 320) },
      { label: 'SPEED',  v: clampNorm(tmp.maxSpeed / 220) },
      { label: 'TURN',   v: clampNorm(tmp.turnSpeed / 6) },
      { label: 'POWER',  v: clampNorm(tmp.dmgMul / 2.4) },
      { label: 'MASS',   v: clampNorm(tmp.mass / 4) },
      { label: 'DEFENSE',v: clampNorm((tmp.deflect + tmp.frontDeflect) * 1.2 + tmp.knockResist * 0.8 + (tmp.antiHazardDmg || 0) * 0.6) },
    ];

    radarCtx.clearRect(0, 0, W, H);

    // Grid rings
    radarCtx.strokeStyle = '#222a3a';
    radarCtx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      radarCtx.beginPath();
      const r = (R * i) / 4;
      for (let a = 0; a < axes.length; a++) {
        const ang = (a / axes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (a === 0) radarCtx.moveTo(x, y); else radarCtx.lineTo(x, y);
      }
      radarCtx.closePath();
      radarCtx.stroke();
    }
    // Axes
    for (let a = 0; a < axes.length; a++) {
      const ang = (a / axes.length) * Math.PI * 2 - Math.PI / 2;
      radarCtx.strokeStyle = '#222a3a';
      radarCtx.beginPath();
      radarCtx.moveTo(cx, cy);
      radarCtx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      radarCtx.stroke();
      radarCtx.fillStyle = '#8a93a6';
      radarCtx.font = '600 9px ui-sans-serif, system-ui';
      radarCtx.textAlign = 'center';
      radarCtx.textBaseline = 'middle';
      radarCtx.fillText(axes[a].label,
        cx + Math.cos(ang) * (R + 12),
        cy + Math.sin(ang) * (R + 12));
    }
    // Polygon fill
    radarCtx.beginPath();
    for (let a = 0; a < axes.length; a++) {
      const ang = (a / axes.length) * Math.PI * 2 - Math.PI / 2;
      const r = R * axes[a].v;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (a === 0) radarCtx.moveTo(x, y); else radarCtx.lineTo(x, y);
    }
    radarCtx.closePath();
    radarCtx.fillStyle = 'rgba(255,106,0,0.25)';
    radarCtx.fill();
    radarCtx.strokeStyle = '#ff6a00';
    radarCtx.lineWidth = 2;
    radarCtx.stroke();
  }

  function clampNorm(v) { return Math.max(0, Math.min(1, v)); }

  // ---------- Public --------------------------------------------------------
  function getSpec() {
    return {
      name: state.name,
      color: state.color,
      accent: state.accent,
      pattern: state.pattern,
      chassis: state.chassis,
      weapon: state.weapon,
      mods: [...state.mods],
      stats: { ...state.stats },
    };
  }

  function refresh() {
    renderColors();
    renderAccents();
    renderPatterns();
    renderTabs();
    renderActiveTab();
    rebuildPreview();
  }

  return { init, getSpec, refresh };
})();
