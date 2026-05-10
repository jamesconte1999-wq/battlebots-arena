// PWA bootstrap — register the service worker and wire the
// "Install App" button on the title screen.
//
// Chrome / Edge fire `beforeinstallprompt` when the site meets installability
// criteria; we cache the event and fire it when the user taps Install.
// iOS Safari does not support this — we show a small hint instead.

const PWA = (() => {
  let deferredPrompt = null;
  let btn = null;
  let hint = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function show() {
    if (!btn) return;
    if (isStandalone()) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
  }

  function init() {
    btn = document.getElementById('btn-install');
    hint = document.getElementById('install-hint');
    if (!btn) return;

    if (isStandalone()) {
      btn.classList.add('hidden');
      return;
    }

    // Default: hidden until we know we can prompt OR we're on iOS.
    btn.classList.add('hidden');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      show();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      btn.classList.add('hidden');
      if (hint) hint.classList.add('hidden');
    });

    btn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (_) {}
        deferredPrompt = null;
        btn.classList.add('hidden');
        return;
      }
      // iOS fallback — show instructions.
      if (isIOS() && hint) {
        hint.classList.toggle('hidden');
      }
    });

    // iOS: there's no install event, but we still want to expose the button
    // with instructions (Share → Add to Home Screen).
    if (isIOS() && !isStandalone()) {
      show();
    }

    // Register the service worker.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      });
    }
  }

  return { init };
})();
