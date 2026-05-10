// Production server URL. The client uses this to find the multiplayer
// server, REST API, and Stripe checkout.
//
// Local dev: leave empty — the client auto-detects localhost:2567.
// Production: set this to your deployed server URL once you have it, e.g.
//   window.ARENABOTS_SERVER = 'https://arenabots-server.onrender.com';
// Then commit + push — Render auto-redeploys the static site.

window.ARENABOTS_SERVER = 'https://api.arenabots.io';

// Dev aid: if we're running on HTTPS (i.e. production-ish) but no server
// URL has been set, loudly warn so it's obvious what's wrong.
(function () {
  if (location.protocol === 'https:' && !window.ARENABOTS_SERVER) {
    console.warn(
      '[arenabots] window.ARENABOTS_SERVER is not set — edit js/env.js with ' +
      'your deployed server URL, then commit + push.'
    );
  }
})();
