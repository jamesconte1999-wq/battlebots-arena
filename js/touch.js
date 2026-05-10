// Mobile / touch controls — analog joystick + fire / pause buttons.
//
// This module exposes BOTH:
//   1. `Touch.getAnalog()` → { active, throttle, turn, fire }
//      arena.js consults this for smooth analog steering / throttle.
//   2. Synthetic keyboard events (`w/a/s/d/space/p`) — so code paths we
//      haven't migrated (e.g. older mp input plumbing) still work.
//
// Active when the device reports a coarse pointer (touchscreens) OR when
// the URL has `?touch=1`. Append `?touch=0` to force-disable for testing.

const Touch = (() => {
  const KEY_FORWARD = 'w';
  const KEY_BACK    = 's';
  const KEY_LEFT    = 'a';
  const KEY_RIGHT   = 'd';
  const KEY_FIRE    = ' ';
  const KEY_PAUSE   = 'p';

  // Joystick tuning — tighter deadzone and gentle curve so small wrist
  // movements still produce noticeable response.
  const DEADZONE = 0.12;          // ignore the very middle
  const RESPONSE_CURVE = 1.5;     // 1.0 = linear, >1 = more precise near center

  let root = null;       // #touch-controls
  let joyEl = null;      // #tc-joystick
  let knobEl = null;     // #tc-joy-knob
  let fireEl = null;     // #tc-fire
  let pauseEl = null;    // #tc-pause

  let enabled = false;

  // Joystick state
  let joyActive  = false;
  let joyPointer = -1;
  let joyCenter  = { x: 0, y: 0 };
  let joyRadius  = 60;

  // Live analog values (-1..1)
  let analog = { x: 0, y: 0 };

  // Live button states
  let fireDown = false;

  // Track which synthetic keys are currently "down".
  const heldKeys = new Set();

  function isTouchDevice() {
    if (location.search.includes('touch=1')) return true;
    if (location.search.includes('touch=0')) return false;
    if (typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches) return true;
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  function dispatchKey(type, key) {
    const ev = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
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
    fireDown = false;
    analog.x = 0; analog.y = 0;
    if (knobEl) knobEl.style.transform = 'translate(0px, 0px)';
  }

  // Apply deadzone + response curve to a normalized axis value.
  function shape(v) {
    const a = Math.abs(v);
    if (a < DEADZONE) return 0;
    const t = (a - DEADZONE) / (1 - DEADZONE);     // 0..1
    const curved = Math.pow(t, RESPONSE_CURVE) * Math.min(1, t * 1.2);
    return Math.sign(v) * Math.min(1, curved);
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

  function updateJoystick(clientX, clientY) {
    let dx = clientX - joyCenter.x;
    let dy = clientY - joyCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > joyRadius) {
      dx = dx * joyRadius / dist;
      dy = dy * joyRadius / dist;
    }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    analog.x = dx / joyRadius;     // -1..1
    analog.y = dy / joyRadius;     // -1..1 (down positive)

    // Also drive synthetic keys so any non-analog consumer still works.
    // Use lower thresholds than before so it triggers more easily.
    const ax = shape(analog.x);
    const ay = shape(analog.y);
    if (ay < -0.05)      { pressKey(KEY_FORWARD); releaseKey(KEY_BACK); }
    else if (ay > 0.05)  { pressKey(KEY_BACK);    releaseKey(KEY_FORWARD); }
    else                 { releaseKey(KEY_FORWARD); releaseKey(KEY_BACK); }
    if (ax < -0.05)      { pressKey(KEY_LEFT);  releaseKey(KEY_RIGHT); }
    else if (ax > 0.05)  { pressKey(KEY_RIGHT); releaseKey(KEY_LEFT); }
    else                 { releaseKey(KEY_LEFT); releaseKey(KEY_RIGHT); }
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
    joyEl.classList.add('active');
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
    joyEl.classList.remove('active');
    knobEl.style.transform = 'translate(0px, 0px)';
    analog.x = 0; analog.y = 0;
    releaseKey(KEY_FORWARD); releaseKey(KEY_BACK);
    releaseKey(KEY_LEFT);    releaseKey(KEY_RIGHT);
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------
  function bindHoldButton(el, key, onChange) {
    const down = (e) => {
      e.preventDefault();
      el.classList.add('active');
      pressKey(key);
      onChange && onChange(true);
    };
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('active');
      releaseKey(key);
      onChange && onChange(false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  function bindTapButton(el, key) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pressKey(key);
      setTimeout(() => releaseKey(key), 30);
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  function getAnalog() {
    if (!enabled) return { active: false, throttle: 0, turn: 0, fire: false };
    // Up on screen = forward. throttle range: -1 (back) .. +1 (forward)
    const throttle = -shape(analog.y);
    const turn     =  shape(analog.x);
    return {
      active: joyActive || fireDown,
      throttle, turn,
      fire: fireDown,
    };
  }

  function isEnabled() { return enabled; }

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

    enabled = true;
    root.classList.remove('hidden');
    document.body.classList.add('touch-mode');

    // Joystick — pointer events for unified mouse + touch.
    joyEl.addEventListener('pointerdown',  onJoyDown);
    joyEl.addEventListener('pointermove',  onJoyMove);
    joyEl.addEventListener('pointerup',    onJoyUp);
    joyEl.addEventListener('pointercancel', onJoyUp);
    window.addEventListener('resize', () => { if (joyActive) measureJoystick(); });

    bindHoldButton(fireEl, KEY_FIRE, (down) => { fireDown = down; });
    bindTapButton(pauseEl, KEY_PAUSE);

    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
  }

  return { init, getAnalog, isEnabled };
})();
