// Mobile / touch controls — virtual joystick + fire + pause buttons.
//
// Strategy: synthesize KeyboardEvents on `window` so the existing keyboard
// handler in arena.js picks them up. This means single-player, multiplayer,
// and server-side input pipelines all work without any changes.
//
// Active when the device reports a coarse pointer (touchscreens, game-pads
// in mouse-emulation mode, etc.) OR when the URL has `?touch=1`. Desktop
// users are unaffected.

const Touch = (() => {
  const KEY_FORWARD = 'w';
  const KEY_BACK    = 's';
  const KEY_LEFT    = 'a';
  const KEY_RIGHT   = 'd';
  const KEY_FIRE    = ' ';
  const KEY_PAUSE   = 'p';

  // Joystick deadzone / activation thresholds (fraction of joystick radius).
  const DEADZONE   = 0.22;   // ignore tiny movements
  const TURN_THRESH = 0.30;  // begin turning beyond this
  const FWD_THRESH  = 0.30;  // begin throttle beyond this

  let root = null;       // #touch-controls
  let joyEl = null;      // #tc-joystick
  let knobEl = null;     // #tc-joy-knob
  let fireEl = null;     // #tc-fire
  let pauseEl = null;    // #tc-pause

  let joyActive  = false;
  let joyPointer = -1;
  let joyCenter  = { x: 0, y: 0 };
  let joyRadius  = 60;

  // Track which synthetic keys are currently "down" so we don't spam events.
  const heldKeys = new Set();

  function isTouchDevice() {
    if (location.search.includes('touch=1')) return true;
    if (location.search.includes('touch=0')) return false;
    if (typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches) return true;
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  function dispatchKey(type, key) {
    const ev = new KeyboardEvent(type, {
      key, bubbles: true, cancelable: true,
    });
    window.dispatchEvent(ev);
  }
  function pressKey(key) {
    if (heldKeys.has(key)) return;
    heldKeys.add(key);
    dispatchKey('keydown', key);
  }
  function releaseKey(key) {
    if (!heldKeys.has(key)) return;
    heldKeys.delete(key);
    dispatchKey('keyup', key);
  }
  function releaseAll() {
    for (const k of Array.from(heldKeys)) releaseKey(k);
  }

  // -------------------------------------------------------------------------
  // Joystick
  // -------------------------------------------------------------------------
  function measureJoystick() {
    const r = joyEl.getBoundingClientRect();
    joyCenter.x = r.left + r.width / 2;
    joyCenter.y = r.top  + r.height / 2;
    joyRadius   = Math.max(20, Math.min(r.width, r.height) / 2);
  }

  function setKnob(dx, dy) {
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function updateJoystick(clientX, clientY) {
    let dx = clientX - joyCenter.x;
    let dy = clientY - joyCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > joyRadius) {
      dx = dx * joyRadius / dist;
      dy = dy * joyRadius / dist;
    }
    setKnob(dx, dy);

    const nx = dx / joyRadius;          // -1..1
    const ny = dy / joyRadius;          // -1..1 (down positive)
    const mag = Math.hypot(nx, ny);
    if (mag < DEADZONE) {
      releaseKey(KEY_FORWARD); releaseKey(KEY_BACK);
      releaseKey(KEY_LEFT);    releaseKey(KEY_RIGHT);
      return;
    }

    // Vertical → throttle (up = forward)
    if (ny <= -FWD_THRESH)      { pressKey(KEY_FORWARD); releaseKey(KEY_BACK); }
    else if (ny >=  FWD_THRESH) { pressKey(KEY_BACK);    releaseKey(KEY_FORWARD); }
    else                        { releaseKey(KEY_FORWARD); releaseKey(KEY_BACK); }

    // Horizontal → turn
    if (nx <= -TURN_THRESH)      { pressKey(KEY_LEFT);  releaseKey(KEY_RIGHT); }
    else if (nx >=  TURN_THRESH) { pressKey(KEY_RIGHT); releaseKey(KEY_LEFT); }
    else                         { releaseKey(KEY_LEFT); releaseKey(KEY_RIGHT); }
  }

  function onJoyDown(e) {
    if (joyActive) return;
    e.preventDefault();
    joyActive  = true;
    joyPointer = e.pointerId;
    measureJoystick();
    if (joyEl.setPointerCapture) {
      try { joyEl.setPointerCapture(e.pointerId); } catch (_) {}
    }
    updateJoystick(e.clientX, e.clientY);
  }
  function onJoyMove(e) {
    if (!joyActive || e.pointerId !== joyPointer) return;
    e.preventDefault();
    updateJoystick(e.clientX, e.clientY);
  }
  function onJoyUp(e) {
    if (!joyActive || e.pointerId !== joyPointer) return;
    e.preventDefault();
    joyActive = false;
    joyPointer = -1;
    setKnob(0, 0);
    releaseKey(KEY_FORWARD); releaseKey(KEY_BACK);
    releaseKey(KEY_LEFT);    releaseKey(KEY_RIGHT);
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------
  function bindHoldButton(el, key) {
    const down = (e) => {
      e.preventDefault();
      el.classList.add('active');
      pressKey(key);
    };
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('active');
      releaseKey(key);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  function bindTapButton(el, key) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // P is a toggle in arena.js — emit a single keydown + keyup pair.
      pressKey(key);
      // Release immediately so a subsequent tap toggles again.
      setTimeout(() => releaseKey(key), 30);
    });
  }

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------
  function init() {
    root    = document.getElementById('touch-controls');
    joyEl   = document.getElementById('tc-joystick');
    knobEl  = document.getElementById('tc-joy-knob');
    fireEl  = document.getElementById('tc-fire');
    pauseEl = document.getElementById('tc-pause');
    if (!root || !joyEl || !knobEl || !fireEl || !pauseEl) return;

    if (!isTouchDevice()) {
      root.classList.add('hidden');
      return;
    }

    // Show the touch overlay; hide the desktop keyboard hint.
    root.classList.remove('hidden');
    document.body.classList.add('touch-mode');

    // Joystick — pointer events for unified mouse + touch.
    joyEl.addEventListener('pointerdown',  onJoyDown);
    joyEl.addEventListener('pointermove',  onJoyMove);
    joyEl.addEventListener('pointerup',    onJoyUp);
    joyEl.addEventListener('pointercancel', onJoyUp);
    window.addEventListener('resize', () => {
      if (joyActive) measureJoystick();
    });

    bindHoldButton(fireEl, KEY_FIRE);
    bindTapButton(pauseEl, KEY_PAUSE);

    // Safety: release everything if we lose focus / page hides.
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
  }

  return { init };
})();
