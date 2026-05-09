// Storefront UI: balance HUDs, store screen, Pro Pass card, crown packs,
// item catalog, and the global Unlock dialog used by the builder.

const Shop = (() => {
  let unlockCtx = null; // { category, item, onAfterBuy? }

  function init() {
    renderBalances();
    document.getElementById('btn-cancel-unlock').addEventListener('click', closeUnlock);
    document.getElementById('btn-pro-from-unlock').addEventListener('click', () => {
      closeUnlock();
      Game.show('store');
    });
    document.getElementById('btn-buy-bolts').addEventListener('click', () => purchaseFromUnlock('bolts'));
    document.getElementById('btn-buy-crowns').addEventListener('click', () => purchaseFromUnlock('crowns'));
  }

  // -------------------------------------------------------------------------
  // Balance HUDs (rendered into every container with class .balance-hud)
  // -------------------------------------------------------------------------
  function renderBalances() {
    const { bolts, crowns } = Store.getBalance();
    const pro = Store.isPro();
    const html = `
      <span class="bal-pill bal-bolts" title="Bolts — earn from matches">
        <span class="bal-icon">⚡</span><span class="bal-num">${formatNum(bolts)}</span>
      </span>
      <span class="bal-pill bal-crowns" title="Crowns — premium currency">
        <span class="bal-icon">♛</span><span class="bal-num">${formatNum(crowns)}</span>
      </span>
      ${pro ? `<span class="bal-pill bal-pro" title="Pro Pass active">★ PRO</span>` : ''}
    `;
    document.querySelectorAll('.balance-hud').forEach(el => el.innerHTML = html);
  }

  function formatNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  // -------------------------------------------------------------------------
  // Store screen
  // -------------------------------------------------------------------------
  function renderStore() {
    const wrap = document.getElementById('store-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(renderProHero());
    wrap.appendChild(renderCrownPacks());
    wrap.appendChild(renderItemSection('Premium Chassis', 'chassis',
      CONFIG.chassis.filter(c => c.pro)));
    wrap.appendChild(renderItemSection('Premium Weapons', 'weapons',
      CONFIG.weapons.filter(w => w.pro)));
    wrap.appendChild(renderItemSection('Premium Mods', 'mods',
      CONFIG.mods.filter(m => m.pro)));
    wrap.appendChild(renderColorSection('Premium Paint', CONFIG.proColors));
    wrap.appendChild(renderItemSection('Premium Patterns', 'patterns',
      CONFIG.patterns.filter(p => p.pro)));
    wrap.appendChild(renderDemoNotice());
  }

  function renderProHero() {
    const wrap = document.createElement('section');
    wrap.className = 'store-hero';
    const pro = Store.proSummary();
    const benefits = `
      <ul class="pro-benefits">
        <li>★ Unlock <b>every</b> premium chassis, weapon, mod, paint &amp; pattern</li>
        <li>★ <b>2× Bolts</b> on all match wins</li>
        <li>★ Animated <b>PRO</b> badge next to your bot name</li>
        <li>★ Priority access to new content drops</li>
      </ul>`;
    if (pro) {
      const exp = pro.lifetime
        ? 'Lifetime'
        : `Renews ${new Date(pro.expiresAt).toLocaleDateString()}`;
      wrap.innerHTML = `
        <div class="pro-card pro-active">
          <div class="pro-card-head">
            <h3>★ PRO PASS · ACTIVE</h3>
            <span class="pro-tag">${pro.plan.toUpperCase()} · ${exp}</span>
          </div>
          ${benefits}
          <div class="pro-actions">
            <button class="btn btn-ghost" id="btn-cancel-pro">Cancel Pro Pass</button>
          </div>
        </div>`;
      setTimeout(() => {
        const c = document.getElementById('btn-cancel-pro');
        if (c) c.addEventListener('click', () => {
          if (confirm('Cancel Pro Pass? You will lose access to premium items you have not yet unlocked.')) {
            Store.cancelPro();
            refreshAll();
          }
        });
      });
    } else {
      wrap.innerHTML = `
        <div class="pro-card">
          <div class="pro-card-head">
            <h3>★ ARENABOTS PRO PASS</h3>
            <span class="pro-tag">${paymentsModeBadge()}</span>
          </div>
          ${benefits}
          <div class="plan-row">
            ${Object.entries(Store.PRO_PLANS).map(([key, plan]) => `
              <button class="plan-card${plan.best ? ' best' : ''}" data-plan="${key}">
                ${plan.best ? '<span class="plan-badge">BEST VALUE</span>' : ''}
                <div class="plan-label">${plan.label}</div>
                <div class="plan-price">$${plan.usd.toFixed(2)}</div>
                ${plan.savePct ? `<div class="plan-save">Save ${plan.savePct}%</div>` : ''}
              </button>
            `).join('')}
          </div>
        </div>`;
      setTimeout(() => {
        wrap.querySelectorAll('.plan-card').forEach(btn => {
          btn.addEventListener('click', () => handleProPurchase(btn.dataset.plan));
        });
      });
    }
    return wrap;
  }

  function renderCrownPacks() {
    const sec = document.createElement('section');
    sec.className = 'store-section';
    sec.innerHTML = `
      <h3 class="store-section-title">Crown Packs</h3>
      <div class="crown-grid">
        ${Object.entries(Store.CROWN_PACKS).map(([key, pack]) => `
          <button class="crown-card${pack.hot ? ' hot' : ''}${pack.best ? ' best' : ''}" data-pack="${key}">
            ${pack.hot ? '<span class="crown-flag">HOT</span>' : ''}
            ${pack.best ? '<span class="crown-flag best">BEST</span>' : ''}
            <div class="crown-amt"><span class="crown-icon">♛</span> ${pack.crowns}</div>
            ${pack.bonus ? `<div class="crown-bonus">+${pack.bonus} bonus</div>` : '<div class="crown-bonus">&nbsp;</div>'}
            <div class="crown-price">$${pack.usd.toFixed(2)}</div>
            <div class="crown-label">${pack.label}</div>
          </button>
        `).join('')}
      </div>
    `;
    setTimeout(() => {
      sec.querySelectorAll('.crown-card').forEach(btn => {
        btn.addEventListener('click', () => handleCrownPurchase(btn.dataset.pack));
      });
    });
    return sec;
  }

  // ---------------------------------------------------------------------------
  // Purchase handlers — route through Stripe when configured, else demo.
  // ---------------------------------------------------------------------------
  function paymentsLive(kind, sku) {
    return typeof Payments !== 'undefined'
      && Payments.isEnabled()
      && Payments.isBuyable(kind, sku)
      && typeof Auth !== 'undefined'
      && Auth.isSignedIn();
  }

  async function handleProPurchase(planKey) {
    const plan = Store.PRO_PLANS[planKey];
    if (!plan) return;
    if (paymentsLive('pro', planKey)) {
      if (!confirm(`Purchase Pro Pass ${plan.label} for $${plan.usd.toFixed(2)}?\n\nYou will be redirected to Stripe Checkout.`)) return;
      try {
        await Payments.checkout({ kind: 'pro', sku: planKey });
      } catch (err) {
        renderToast('Checkout failed: ' + err.message);
      }
      return;
    }
    // Fallback: demo flow (or prompt to sign in if Stripe is configured).
    const reason = demoReason('pro', planKey);
    if (!confirm(`Activate Pro Pass — ${plan.label} for $${plan.usd.toFixed(2)}?\n\n${reason}`)) return;
    const res = Store.activatePro(planKey);
    if (res.ok) {
      renderToast('★ Pro Pass activated (demo).');
      refreshAll();
    }
  }

  async function handleCrownPurchase(packKey) {
    const pack = Store.CROWN_PACKS[packKey];
    if (!pack) return;
    if (paymentsLive('crowns', packKey)) {
      if (!confirm(`Buy ${pack.crowns + pack.bonus} Crowns for $${pack.usd.toFixed(2)}?\n\nYou will be redirected to Stripe Checkout.`)) return;
      try {
        await Payments.checkout({ kind: 'crowns', sku: packKey });
      } catch (err) {
        renderToast('Checkout failed: ' + err.message);
      }
      return;
    }
    const reason = demoReason('crowns', packKey);
    if (!confirm(`Buy ${pack.crowns + pack.bonus} Crowns for $${pack.usd.toFixed(2)}?\n\n${reason}`)) return;
    const res = Store.buyCrownPack(packKey);
    if (res.ok) {
      renderToast(`+${res.total} Crowns (demo).`);
      refreshAll();
    }
  }

  // Explain why we're in demo mode so shoppers aren't confused.
  function demoReason(kind, sku) {
    if (typeof Payments === 'undefined') return 'DEMO MODE — no real charge.';
    if (!Payments.isEnabled()) return 'DEMO MODE — real payments not configured on this server.';
    if (typeof Auth !== 'undefined' && !Auth.isSignedIn()) {
      return 'DEMO MODE — sign in from the main menu to enable real purchases.';
    }
    if (!Payments.isBuyable(kind, sku)) return 'DEMO MODE — this product is not yet set up in Stripe.';
    return 'DEMO MODE — no real charge.';
  }

  function renderItemSection(title, category, items) {
    const sec = document.createElement('section');
    sec.className = 'store-section';
    if (!items || items.length === 0) {
      sec.innerHTML = `<h3 class="store-section-title">${title}</h3><p class="store-empty">No premium items in this category yet.</p>`;
      return sec;
    }
    sec.innerHTML = `<h3 class="store-section-title">${title}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const item of items) {
      grid.appendChild(buildItemCard(category, item));
    }
    sec.appendChild(grid);
    return sec;
  }

  function renderColorSection(title, colors) {
    const sec = document.createElement('section');
    sec.className = 'store-section';
    sec.innerHTML = `<h3 class="store-section-title">${title}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'paint-grid';
    for (const c of colors) {
      const owned = Store.isOwned('colors', c.id);
      const price = Store.priceFor('colors', c);
      const card = document.createElement('div');
      card.className = 'paint-card' + (owned ? ' owned' : '');
      card.innerHTML = `
        <div class="paint-swatch" style="background:${c.hex}"></div>
        <div class="paint-name">${c.name}</div>
        ${owned
          ? '<div class="paint-owned">✓ Owned</div>'
          : `<div class="paint-prices">
              <button class="btn btn-bolts btn-sm" data-cur="bolts">⚡ ${price.bolts}</button>
              <button class="btn btn-crowns btn-sm" data-cur="crowns">♛ ${price.crowns}</button>
            </div>`}
      `;
      if (!owned) {
        card.querySelectorAll('button[data-cur]').forEach(btn => {
          btn.addEventListener('click', () => {
            const cur = btn.dataset.cur;
            const res = Store.buy('colors', c.id, cur);
            handleBuyResult(res);
          });
        });
      }
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    return sec;
  }

  function buildItemCard(category, item) {
    const owned = Store.isOwned(category, item.id);
    const price = Store.priceFor(category, item);
    const card = document.createElement('div');
    card.className = 'card big-card store-card' + (owned ? ' owned' : '');
    card.innerHTML = `
      <div class="card-title">${item.name}<span class="card-tag pro">${item.tag || 'PRO'}</span></div>
      <div class="card-desc">${item.desc || ''}</div>
      ${owned
        ? '<div class="store-owned">✓ Owned</div>'
        : `<div class="store-prices">
            <button class="btn btn-bolts btn-sm" data-cur="bolts">⚡ ${price.bolts}</button>
            <button class="btn btn-crowns btn-sm" data-cur="crowns">♛ ${price.crowns}</button>
          </div>`}
    `;
    if (!owned) {
      card.querySelectorAll('button[data-cur]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const cur = btn.dataset.cur;
          const res = Store.buy(category, item.id, cur);
          handleBuyResult(res);
        });
      });
    }
    return card;
  }

  function renderDemoNotice() {
    const div = document.createElement('div');
    div.className = 'store-demo';
    const live = typeof Payments !== 'undefined' && Payments.isEnabled();
    const signedIn = typeof Auth !== 'undefined' && Auth.isSignedIn();
    if (live && signedIn) {
      div.innerHTML = `
        <strong>Live Payments</strong> · Purchases are processed by Stripe.
        Crowns and Pro Pass are tied to your account and available on any device
        you sign in from.
      `;
    } else if (live && !signedIn) {
      div.innerHTML = `
        <strong>Sign in to buy</strong> · Real payments are enabled on this
        server. <a href="#" id="store-signin-link">Sign in or create a free
        account</a> to purchase Crowns or the Pro Pass.
      `;
      setTimeout(() => {
        const link = document.getElementById('store-signin-link');
        if (link) link.addEventListener('click', (e) => {
          e.preventDefault();
          const btn = document.getElementById('btn-show-auth');
          if (btn) btn.click();
        });
      });
    } else {
      div.innerHTML = `
        <strong>Demo Mode</strong> · Real payments are not configured on this
        server. Purchases simulate the live flow and persist in your browser
        only. See <code>PAYMENTS.md</code> in the server repo to enable Stripe.
      `;
    }
    return div;
  }

  // Short badge used on the Pro card header.
  function paymentsModeBadge() {
    const live = typeof Payments !== 'undefined' && Payments.isEnabled();
    return live ? 'LIVE' : 'DEMO';
  }

  // -------------------------------------------------------------------------
  // Unlock dialog (used by builder)
  // -------------------------------------------------------------------------
  function openUnlock(category, item, onAfterBuy) {
    unlockCtx = { category, item, onAfterBuy };
    const overlay = document.getElementById('unlock-overlay');
    const price = Store.priceFor(category, item);

    document.getElementById('unlock-title').textContent = item.name || 'Premium Item';
    document.getElementById('unlock-desc').textContent =
      item.desc || (category === 'colors' ? `Premium ${item.name} paint.` : 'Premium content.');

    const bb = document.getElementById('btn-buy-bolts');
    const cb = document.getElementById('btn-buy-crowns');
    const { bolts, crowns } = Store.getBalance();
    bb.textContent = `Buy with ⚡ ${price.bolts}`;
    bb.disabled = bolts < price.bolts;
    cb.textContent = `Buy with ♛ ${price.crowns}`;
    cb.disabled = crowns < price.crowns;

    // Visual preview based on category
    const prev = document.getElementById('unlock-preview');
    if (category === 'colors') {
      prev.innerHTML = `<div class="paint-swatch" style="background:${item.hex}"></div>`;
    } else {
      prev.innerHTML = `<div class="unlock-tag">${item.tag || category.toUpperCase()}</div>`;
    }
    overlay.classList.remove('hidden');
  }

  function closeUnlock() {
    document.getElementById('unlock-overlay').classList.add('hidden');
    unlockCtx = null;
  }

  function purchaseFromUnlock(currency) {
    if (!unlockCtx) return;
    const res = Store.buy(unlockCtx.category, unlockCtx.item.id, currency);
    if (res.ok) {
      const cb = unlockCtx.onAfterBuy;
      closeUnlock();
      renderToast(`Unlocked: ${res.item ? res.item.name : 'Item'}`);
      refreshAll();
      if (cb) cb();
    } else {
      renderToast(res.reason === 'insufficient_bolts'
        ? 'Not enough Bolts.'
        : res.reason === 'insufficient_crowns'
          ? 'Not enough Crowns.'
          : 'Purchase failed.');
    }
  }

  function handleBuyResult(res) {
    if (res.ok) {
      renderToast(`Unlocked: ${res.item ? res.item.name : 'Item'}`);
      refreshAll();
    } else if (res.reason === 'insufficient_bolts') {
      renderToast('Not enough Bolts. Win matches or buy crowns.');
    } else if (res.reason === 'insufficient_crowns') {
      renderToast('Not enough Crowns. Buy a Crown Pack from the store.');
    }
  }

  // -------------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------------
  function renderToast(msg) {
    let el = document.getElementById('toast-zone');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-zone';
      document.body.appendChild(el);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2400);
  }

  // -------------------------------------------------------------------------
  function refreshAll() {
    renderBalances();
    if (document.getElementById('screen-store').classList.contains('active')) {
      renderStore();
    }
    if (typeof Builder !== 'undefined' && Builder.refresh) Builder.refresh();
  }

  return { init, renderStore, renderBalances, openUnlock, closeUnlock, renderToast, refreshAll };
})();
