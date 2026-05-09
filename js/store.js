// Economy + monetization framework.
// Holds soft currency (Bolts), hard currency (Crowns), owned premium items,
// Pro Pass status, and persistence via localStorage.
// All purchases run in DEMO MODE — no real payment is processed.

const Store = (() => {
  const KEY = 'arenabots_store_v1';

  // ----- Pricing tables ------------------------------------------------------
  const CROWN_PACKS = {
    starter: { crowns: 100,  bonus: 0,   usd: 1.99,  label: 'Starter' },
    plus:    { crowns: 300,  bonus: 60,  usd: 4.99,  label: 'Plus',     hot: true },
    pro:     { crowns: 700,  bonus: 200, usd: 9.99,  label: 'Pro',      best: true },
    elite:   { crowns: 1500, bonus: 500, usd: 19.99, label: 'Elite' },
  };

  const PRO_PLANS = {
    monthly:  { days: 30,   usd: 4.99,  label: 'Monthly'  },
    yearly:   { days: 365,  usd: 39.99, label: 'Yearly',  best: true, savePct: 33 },
    lifetime: { days: null, usd: 79.99, label: 'Lifetime' },
  };

  // Default prices when an item has `pro: true` but doesn't override.
  const DEFAULT_PRICE = {
    chassis:  { bolts: 800, crowns: 50 },
    weapons:  { bolts: 600, crowns: 40 },
    mods:     { bolts: 500, crowns: 35 },
    colors:   { bolts: 200, crowns: 15 },
    patterns: { bolts: 250, crowns: 18 },
  };

  // ----- State ---------------------------------------------------------------
  const state = {
    bolts: 200,    // welcome grant
    crowns: 30,
    owned: { chassis: [], weapons: [], mods: [], colors: [], patterns: [] },
    pro: false,
    proExpiresAt: null,
    proPlan: null,
    stats: { wins: 0, losses: 0, championships: 0, totalEarned: 0, matchesPlayed: 0 },
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        Object.assign(state, data);
        // Defensive: normalise nested shapes
        state.owned = Object.assign({ chassis: [], weapons: [], mods: [], colors: [], patterns: [] }, state.owned || {});
        state.stats = Object.assign({ wins: 0, losses: 0, championships: 0, totalEarned: 0, matchesPlayed: 0 }, state.stats || {});
      }
    } catch (e) { /* ignore corrupt */ }
    if (state.proExpiresAt && Date.now() > state.proExpiresAt) {
      state.pro = false;
      state.proExpiresAt = null;
      state.proPlan = null;
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ----- Prices --------------------------------------------------------------
  function priceFor(category, item) {
    if (!item || !item.pro) return null;
    const def = DEFAULT_PRICE[category] || { bolts: 500, crowns: 35 };
    return {
      bolts:  item.priceBolts  ?? def.bolts,
      crowns: item.priceCrowns ?? def.crowns,
    };
  }

  // ----- Ownership ----------------------------------------------------------
  function isOwned(category, id) {
    if (state.pro) return true; // Pro members own everything cosmetic.
    return (state.owned[category] || []).includes(id);
  }
  function isAvailable(category, item) {
    if (!item) return false;
    if (!item.pro) return true;       // Free item, always available.
    return isOwned(category, item.id);
  }

  // ----- Purchases ----------------------------------------------------------
  // Locate a premium item by category + id.
  // 'colors' category uses CONFIG.proColors, others use CONFIG[category].
  function findItem(category, id) {
    if (category === 'colors') return (CONFIG.proColors || []).find(x => x.id === id);
    return (CONFIG[category] || []).find(x => x.id === id);
  }

  function buy(category, id, currency /* 'bolts' | 'crowns' */) {
    const item = findItem(category, id);
    if (!item || !item.pro) return { ok: false, reason: 'not_premium' };
    if (isOwned(category, id)) return { ok: true, reason: 'already_owned' };
    const price = priceFor(category, item);
    if (currency === 'crowns') {
      if (state.crowns < price.crowns) return { ok: false, reason: 'insufficient_crowns' };
      state.crowns -= price.crowns;
    } else {
      if (state.bolts < price.bolts) return { ok: false, reason: 'insufficient_bolts' };
      state.bolts -= price.bolts;
    }
    state.owned[category].push(id);
    save();
    return { ok: true, item, price, currency };
  }

  function buyCrownPack(packKey) {
    const pack = CROWN_PACKS[packKey];
    if (!pack) return { ok: false };
    // DEMO: no real payment processing.
    state.crowns += pack.crowns + pack.bonus;
    save();
    return { ok: true, pack, total: pack.crowns + pack.bonus };
  }

  function activatePro(planKey) {
    const plan = PRO_PLANS[planKey];
    if (!plan) return { ok: false };
    // DEMO: no real subscription billing.
    state.pro = true;
    state.proPlan = planKey;
    state.proExpiresAt = plan.days ? Date.now() + plan.days * 86400000 : null;
    save();
    return { ok: true, plan };
  }

  function cancelPro() {
    state.pro = false;
    state.proPlan = null;
    state.proExpiresAt = null;
    save();
  }

  // ----- Match rewards -------------------------------------------------------
  function grantWinReward(roundIndex, isFinal) {
    let reward = 50 + roundIndex * 10;
    if (isFinal) reward += 250;
    if (state.pro) reward *= 2;
    state.bolts += reward;
    state.stats.wins++;
    state.stats.matchesPlayed++;
    state.stats.totalEarned += reward;
    if (isFinal) state.stats.championships++;
    save();
    return reward;
  }
  function grantLossPenalty() {
    state.stats.losses++;
    state.stats.matchesPlayed++;
    save();
  }

  // ----- Public access ------------------------------------------------------
  function getBalance()  { return { bolts: state.bolts, crowns: state.crowns }; }
  function getState()    { return state; }
  function isPro()       { return state.pro; }
  function proSummary()  {
    if (!state.pro) return null;
    return {
      plan: state.proPlan,
      expiresAt: state.proExpiresAt,
      lifetime: !state.proExpiresAt,
    };
  }

  // ----- Cheat helper for development --------------------------------------
  function devGrant(bolts = 0, crowns = 0) {
    state.bolts += bolts;
    state.crowns += crowns;
    save();
  }

  load();

  return {
    CROWN_PACKS, PRO_PLANS, DEFAULT_PRICE,
    isOwned, isAvailable, priceFor, findItem,
    buy, buyCrownPack, activatePro, cancelPro,
    grantWinReward, grantLossPenalty,
    getBalance, getState, isPro, proSummary,
    save, devGrant,
  };
})();
