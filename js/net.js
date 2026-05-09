// Net: thin Colyseus client wrapper.
// Owns one room connection at a time. Higher layers (mp.js) install
// callbacks via Net.on(...) before calling Net.joinArena(...).

const Net = (() => {
  let client = null;
  let room = null;
  let listeners = {};

  function endpoint() {
    if (typeof window.ARENABOTS_SERVER === 'string' && window.ARENABOTS_SERVER) {
      return window.ARENABOTS_SERVER.replace(/^http/, 'ws');
    }
    if (location.protocol === 'file:') return 'ws://localhost:2567';
    if (location.port === '8765' || location.port === '5500' || location.port === '3000') {
      return 'ws://' + location.hostname + ':2567';
    }
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }

  function emit(name, ...args) {
    const arr = listeners[name] || [];
    for (const fn of arr) {
      try { fn(...args); } catch (e) { console.error('[Net]', name, e); }
    }
  }
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return () => off(name, fn);
  }
  function off(name, fn) {
    if (!listeners[name]) return;
    listeners[name] = listeners[name].filter(f => f !== fn);
  }

  async function joinArena({ name, loadout, token }) {
    if (!window.Colyseus) throw new Error('Colyseus SDK missing');
    if (!client) client = new Colyseus.Client(endpoint());
    if (room) { try { await room.leave(true); } catch (_) {} room = null; }

    const opts = { name, loadout };
    if (token) opts.token = token;

    room = await client.joinOrCreate('arena_ffa', opts);

    // Wire room lifecycle to local listeners ----------------------------------
    room.onStateChange.once((state) => emit('state', state));
    room.onStateChange((state) => emit('tick', state));

    room.onMessage('match-end', (payload) => emit('match-end', payload));
    room.onError((code, msg) => emit('error', { code, msg }));
    room.onLeave((code) => {
      const wasRoom = room;
      room = null;
      emit('leave', { code, room: wasRoom });
    });

    return room;
  }

  function sendInput(input) {
    if (!room) return;
    try { room.send('input', input); } catch (_) {}
  }

  async function leave() {
    if (!room) return;
    try { await room.leave(true); } catch (_) {}
    room = null;
  }

  function getRoom() { return room; }
  function getSessionId() { return room ? room.sessionId : ''; }

  return { joinArena, sendInput, leave, on, off, getRoom, getSessionId };
})();
