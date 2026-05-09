// Payments: client-side Stripe Checkout flow.
//   Payments.init()               - fetches product catalog + syncs entitlements
//   Payments.isEnabled()          - bool, true if the server has Stripe configured
//   Payments.getProducts()        - cached /api/products response
//   Payments.checkout({kind,sku}) - opens Stripe Checkout (requires auth)
//   Payments.syncEntitlements()   - POSTS nothing; GETs /api/entitlements and
//                                   applies to the local Store cache so the
//                                   balance HUD shows server truth.
//   Payments.detectReturn()       - called on page load; if URL has
//                                   ?stripe_session=..., polls entitlements
//                                   briefly and shows a success toast.

const Payments = (() => {
  let productsCache = null;
  let lastSyncAt = 0;

  // Server base is shared with Auth.
  function base() {
    if (typeof Auth !== 'undefined' && Auth.serverBase) return Auth.serverBase();
    return location.origin;
  }

  async function _get(path) {
    const headers = {};
    const t = (typeof Auth !== 'undefined') ? Auth.token() : '';
    if (t) headers.Authorization = 'Bearer ' + t;
    const r = await fetch(base() + path, { headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('http ' + r.status));
    return data;
  }
  async function _post(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = (typeof Auth !== 'undefined') ? Auth.token() : '';
    if (t) headers.Authorization = 'Bearer ' + t;
    const r = await fetch(base() + path, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('http ' + r.status));
    return data;
  }

  // ---------------------------------------------------------------------------
  async function init() {
    try {
      productsCache = await _get('/api/products');
    } catch (e) {
      console.warn('[payments] products fetch failed:', e.message);
      productsCache = { enabled: false, crowns: {}, pro: {} };
    }
    // If user is signed in, sync entitlements into local Store on boot.
    if (typeof Auth !== 'undefined' && Auth.isSignedIn()) {
      syncEntitlements().catch(() => {});
    }
    detectReturn();
  }

  function isEnabled() {
    return !!(productsCache && productsCache.enabled);
  }
  function getProducts() {
    return productsCache || { enabled: false, crowns: {}, pro: {} };
  }
  function isBuyable(kind, sku) {
    const p = getProducts();
    return !!(p[kind] && p[kind][sku] && p[kind][sku].buyable);
  }

  // ---------------------------------------------------------------------------
  // Checkout
  // ---------------------------------------------------------------------------
  async function checkout({ kind, sku }) {
    if (!isEnabled()) throw new Error('payments not enabled');
    if (!isBuyable(kind, sku)) throw new Error('sku not buyable — set its STRIPE_PRICE_* env var');
    if (typeof Auth === 'undefined' || !Auth.isSignedIn()) {
      throw new Error('must be signed in to purchase');
    }
    const res = await _post('/api/checkout/create', { kind, sku });
    if (!res.url) throw new Error('no checkout url returned');
    // Redirect the whole tab to Stripe Checkout. Stripe will send the user
    // back to PUBLIC_BASE_URL with ?stripe_session=cs_... on success.
    window.location.href = res.url;
  }

  // ---------------------------------------------------------------------------
  // Entitlements sync
  //
  // Server is the source of truth for signed-in users. We mirror the server's
  // entitlements into the client Store so the existing balance HUD / Pro
  // gating keep working without rewrites.
  // ---------------------------------------------------------------------------
  async function syncEntitlements() {
    if (typeof Auth === 'undefined' || !Auth.isSignedIn()) return null;
    let data;
    try {
      data = await _get('/api/entitlements');
    } catch (e) {
      console.warn('[payments] entitlements sync failed:', e.message);
      return null;
    }
    lastSyncAt = Date.now();
    applyEntitlementsToStore(data);
    return data;
  }

  function applyEntitlementsToStore(ent) {
    if (typeof Store === 'undefined' || !ent) return;
    const s = Store.getState();
    // Crowns: server is truth for signed-in users.
    s.crowns = ent.crowns | 0;
    // Pro pass
    if (ent.pro_until === 'lifetime') {
      s.pro = true;
      s.proPlan = 'lifetime';
      s.proExpiresAt = null;
    } else if (ent.pro_until && Date.parse(ent.pro_until) > Date.now()) {
      s.pro = true;
      s.proPlan = ent.pro_plan || null;
      s.proExpiresAt = Date.parse(ent.pro_until);
    } else {
      s.pro = false;
      s.proPlan = null;
      s.proExpiresAt = null;
    }
    Store.save();
    if (typeof Shop !== 'undefined') {
      Shop.renderBalances();
      Shop.refreshAll && Shop.refreshAll();
    }
  }

  // ---------------------------------------------------------------------------
  // Return-from-Stripe handling
  //
  // Stripe redirects to PUBLIC_BASE_URL/?stripe_session=cs_... on success.
  // We poll entitlements for up to ~10s because the webhook might land a
  // moment after the user is redirected.
  // ---------------------------------------------------------------------------
  function detectReturn() {
    const q = new URLSearchParams(location.search);
    const sessionId = q.get('stripe_session');
    const cancel    = q.get('stripe_cancel');
    if (!sessionId && !cancel) return;

    // Strip the query so a refresh doesn't re-trigger.
    const clean = location.pathname + location.hash;
    history.replaceState({}, '', clean);

    if (cancel) {
      toast('Purchase canceled.');
      return;
    }
    if (!Auth || !Auth.isSignedIn()) return;

    const kind = q.get('kind') || '';
    const sku  = q.get('sku')  || '';
    toast('Processing purchase…');

    const before = (typeof Store !== 'undefined') ? { ...Store.getBalance() } : null;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const data = await syncEntitlements();
      const after = (typeof Store !== 'undefined') ? Store.getBalance() : null;

      // Did anything change? Crowns increase, or pro flipped on.
      const crownsUp = before && after && after.crowns > before.crowns;
      const proOn    = data && data.pro_active;

      if (crownsUp || proOn) {
        clearInterval(timer);
        if (kind === 'crowns') {
          const delta = after.crowns - (before ? before.crowns : 0);
          toast(`+${delta} Crowns added to your account!`);
        } else if (kind === 'pro') {
          toast('★ Pro Pass activated!');
        } else {
          toast('Purchase complete!');
        }
      } else if (attempts >= 10) {
        clearInterval(timer);
        toast('Purchase received — entitlements will update shortly.');
      }
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  function toast(msg) {
    if (typeof Shop !== 'undefined' && Shop.renderToast) {
      Shop.renderToast(msg);
    } else {
      console.log('[payments]', msg);
    }
  }

  return {
    init, isEnabled, isBuyable, getProducts,
    checkout, syncEntitlements, detectReturn,
  };
})();
