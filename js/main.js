// Top-level: screen routing and tournament progression.

const Game = (() => {
  const screens = ['title', 'builder', 'arena', 'store', 'result'];
  let roundIndex = 0;
  let totalRounds = CONFIG.opponents.length;
  let lastResult = null;
  let lastReward = 0;

  function show(name) {
    screens.forEach(s => {
      const el = document.getElementById('screen-' + s);
      if (el) el.classList.toggle('active', s === name);
    });
    if (typeof Shop !== 'undefined') {
      Shop.renderBalances();
      if (name === 'store') Shop.renderStore();
    }
  }

  function init() {
    Builder.init();
    Arena.init();
    if (typeof Shop !== 'undefined') Shop.init();
    if (typeof MP !== 'undefined') MP.init();
    if (typeof Payments !== 'undefined') Payments.init();
    if (typeof Touch !== 'undefined') Touch.init();
    if (typeof PWA !== 'undefined') PWA.init();
    initAuthUI();
    initLadderUI();
    initHelpUI();
    renderAccountPill();

    // Wire data-go links
    document.body.addEventListener('click', e => {
      const t = e.target.closest('[data-go]');
      if (!t) return;
      const dest = t.dataset.go;
      if (dest === 'arena') startNextRound();
      else if (dest === 'title') {
        if (typeof MP !== 'undefined') MP.stop();
        Arena.stop();
        roundIndex = 0;
        show('title');
      } else if (dest === 'builder') {
        if (typeof MP !== 'undefined') MP.stop();
        Arena.stop();
        show('builder');
      } else if (dest === 'store') {
        show('store');
      }
    });

    document.getElementById('btn-fight').addEventListener('click', () => {
      roundIndex = 0;
      startNextRound();
    });

    document.getElementById('btn-next').addEventListener('click', () => {
      if (lastResult === 'player' && roundIndex < totalRounds) {
        startNextRound();
      } else {
        // After a loss/draw or completion, go back to builder
        roundIndex = 0;
        show('builder');
      }
    });

    show('title');
  }

  // ---------------------------------------------------------------------------
  // Auth UI (modal sign-up / log-in)
  // ---------------------------------------------------------------------------
  function initAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    let mode = 'login';

    const tabs = overlay.querySelectorAll('.auth-tab');
    const displayWrap = overlay.querySelector('.auth-display');
    const submit = document.getElementById('auth-submit');
    const errEl = document.getElementById('auth-error');

    function renderMode() {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.authTab === mode));
      displayWrap.classList.toggle('hidden', mode !== 'signup');
      submit.textContent = mode === 'signup' ? 'Create account' : 'Log in';
      errEl.classList.add('hidden');
    }
    tabs.forEach(t => t.addEventListener('click', () => {
      mode = t.dataset.authTab;
      renderMode();
    }));
    renderMode();

    document.getElementById('btn-show-auth').addEventListener('click', () => {
      if (Auth.isSignedIn()) {
        if (confirm('Sign out?')) {
          Auth.logout();
          // Reset crowns/pro to guest defaults so the next user doesn't
          // inherit the signed-out account's balance HUD.
          if (typeof Store !== 'undefined') {
            const s = Store.getState();
            s.crowns = 0;
            s.pro = false;
            s.proPlan = null;
            s.proExpiresAt = null;
            Store.save();
          }
          renderAccountPill();
          if (typeof Shop !== 'undefined') {
            Shop.renderBalances();
            Shop.refreshAll && Shop.refreshAll();
          }
        }
        return;
      }
      overlay.classList.remove('hidden');
    });
    document.getElementById('auth-cancel').addEventListener('click', () => {
      overlay.classList.add('hidden');
    });

    document.getElementById('auth-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const username = document.getElementById('auth-username').value.trim();
      const password = document.getElementById('auth-password').value;
      const display  = document.getElementById('auth-display').value.trim();
      errEl.classList.add('hidden');
      try {
        if (mode === 'signup') {
          await Auth.signup(username, password, display || username);
        } else {
          await Auth.login(username, password);
        }
        overlay.classList.add('hidden');
        renderAccountPill();
        // Pull server-truth entitlements into the local Store cache.
        if (typeof Payments !== 'undefined') Payments.syncEntitlements().catch(() => {});
      } catch (err) {
        errEl.textContent = err.message || 'failed';
        errEl.classList.remove('hidden');
      }
    });
  }

  function renderAccountPill() {
    const pill = document.getElementById('account-pill');
    if (!pill) return;
    if (Auth.isSignedIn()) {
      const a = Auth.account();
      pill.innerHTML = `<span class="acct-dot"></span><span class="acct-name">${escapeHtml(a.displayName || a.username)}</span><span class="acct-link">sign out</span>`;
    } else {
      pill.innerHTML = '';
    }
    // Refresh ladder/level info async if signed in
    if (Auth.isSignedIn()) {
      Auth.me().then(m => {
        if (!m || !m.stats) return;
        const a = Auth.account();
        const s = m.stats;
        pill.innerHTML = `<span class="acct-dot"></span><span class="acct-name">${escapeHtml(a.displayName || a.username)}</span><span class="acct-stats">L${s.level || 1} · ${s.wins || 0}W / ${s.losses || 0}L · ${s.rank_points || 0} RP</span><span class="acct-link">sign out</span>`;
      }).catch(() => {});
    }
  }

  function initLadderUI() {
    const overlay = document.getElementById('ladder-overlay');
    if (!overlay) return;
    const list = document.getElementById('ladder-list');
    document.getElementById('ladder-close').addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
    document.getElementById('btn-show-ladder').addEventListener('click', async () => {
      overlay.classList.remove('hidden');
      list.textContent = 'Loading…';
      try {
        const { entries } = await Auth.ladder();
        if (!entries || !entries.length) {
          list.innerHTML = '<p class="ladder-empty">No ranked players yet — be the first!</p>';
          return;
        }
        list.innerHTML = entries.map((e, i) => `
          <div class="ladder-row">
            <span class="lr-rank">#${i + 1}</span>
            <span class="lr-name">${escapeHtml(e.display_name)}</span>
            <span class="lr-level">L${e.level}</span>
            <span class="lr-rp">${e.rank_points} RP</span>
            <span class="lr-wk">${e.wins}W · ${e.kills}K</span>
          </div>`).join('');
      } catch (err) {
        list.innerHTML = `<p class="ladder-empty">Could not load ladder: ${escapeHtml(err.message)}</p>`;
      }
    });
  }

  function initHelpUI() {
    const overlay = document.getElementById('help-overlay');
    if (!overlay) return;
    document.getElementById('btn-show-help').addEventListener('click', () => {
      overlay.classList.remove('hidden');
    });
    document.getElementById('help-close').addEventListener('click', () => {
      overlay.classList.add('hidden');
      try { localStorage.setItem('ab_help_seen', '1'); } catch (_) {}
    });
    // Auto-show for first-time visitors
    try {
      if (!localStorage.getItem('ab_help_seen')) {
        overlay.classList.remove('hidden');
      }
    } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function startNextRound() {
    if (roundIndex >= totalRounds) {
      // Champion!
      showResult('champion');
      return;
    }
    const playerSpec = Builder.getSpec();
    const enemySpec = CONFIG.opponents[roundIndex];
    roundIndex++;

    // Add pro status to player spec if user is pro
    if (typeof Store !== 'undefined') {
      const s = Store.getState();
      if (s.pro) {
        playerSpec.isPro = true;
      }
    }

    show('arena');
    Arena.start(playerSpec, enemySpec, roundIndex, totalRounds, onMatchEnd);
  }

  function onMatchEnd(winner, info) {
    lastResult = winner;
    lastReward = 0;
    if (typeof Store !== 'undefined') {
      if (winner === 'player') {
        const isFinal = roundIndex >= totalRounds;
        lastReward = Store.grantWinReward(roundIndex, isFinal);
      } else if (winner === 'enemy' || winner === 'draw') {
        Store.grantLossPenalty();
      }
      if (typeof Shop !== 'undefined') Shop.renderBalances();
    }
    showResult(winner, info);
  }

  function showResult(winner, info) {
    show('result');
    const title = document.getElementById('result-title');
    const sub = document.getElementById('result-sub');
    const nextBtn = document.getElementById('btn-next');
    const rewardLine = lastReward > 0 ? `<div class="reward-line">+ ⚡ ${lastReward} bolts earned</div>` : '';

    if (winner === 'player') {
      if (roundIndex >= totalRounds) {
        title.textContent = 'CHAMPION!';
        sub.innerHTML = `You defeated all ${totalRounds} opponents. ${rewardLine}`;
        nextBtn.textContent = 'Restart Tournament';
        roundIndex = 0;
      } else {
        title.textContent = 'VICTORY';
        sub.innerHTML = `Round ${roundIndex} won. ${totalRounds - roundIndex} opponent(s) remain. ${rewardLine}`;
        nextBtn.textContent = 'Next Match →';
      }
    } else if (winner === 'enemy') {
      title.textContent = 'DEFEATED';
      sub.innerHTML = 'Your bot was wrecked. Rebuild and try again.';
      nextBtn.textContent = 'Rebuild Bot';
    } else if (winner === 'champion') {
      title.textContent = 'CHAMPION!';
      sub.innerHTML = `Already crowned. Restart the tournament?`;
      nextBtn.textContent = 'Restart Tournament';
      roundIndex = 0;
    } else {
      title.textContent = 'DRAW';
      sub.innerHTML = 'Time expired with both bots standing. Tournament resets.';
      nextBtn.textContent = 'Try Again';
      roundIndex = 0;
    }
  }

  return { init, show };
})();

window.addEventListener('DOMContentLoaded', Game.init);
