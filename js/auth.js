// Auth: thin wrapper around the server's /api/{signup,login,me,ladder}.
// Token is persisted in localStorage so signed-in users stay signed in
// across reloads. Anonymous play remains supported — Auth.token() simply
// returns '' if the user has not signed in.

const Auth = (() => {
  const KEY_TOKEN = 'arenabots.auth.token';
  const KEY_ACCT  = 'arenabots.auth.account';

  // Server base — same origin in production builds (when client is served
  // from the server itself), or the dev URL otherwise. Override with
  //   window.ARENABOTS_SERVER = 'wss://my-server.example';
  // before this script loads.
  function serverBase() {
    if (typeof window.ARENABOTS_SERVER === 'string' && window.ARENABOTS_SERVER) {
      return window.ARENABOTS_SERVER.replace(/^ws/, 'http');
    }
    if (location.protocol === 'file:') return 'http://localhost:2567';
    if (location.port === '8765' || location.port === '5500' || location.port === '3000') {
      // Static dev server → connect to the local game server.
      return 'http://' + location.hostname + ':2567';
    }
    return location.origin;
  }

  function token() { return localStorage.getItem(KEY_TOKEN) || ''; }
  function account() {
    const raw = localStorage.getItem(KEY_ACCT);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  function isSignedIn() { return !!token() && !!account(); }

  function _save(payload) {
    if (payload && payload.token) localStorage.setItem(KEY_TOKEN, payload.token);
    if (payload && payload.account) {
      localStorage.setItem(KEY_ACCT, JSON.stringify(payload.account));
    }
  }
  function logout() {
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_ACCT);
  }

  async function _post(path, body) {
    const res = await fetch(serverBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('http ' + res.status));
    return data;
  }
  async function _get(path) {
    const headers = {};
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch(serverBase() + path, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('http ' + res.status));
    return data;
  }

  async function signup(username, password, displayName) {
    const data = await _post('/api/signup', { username, password, displayName });
    _save(data);
    return data;
  }
  async function login(username, password) {
    const data = await _post('/api/login', { username, password });
    _save(data);
    return data;
  }
  async function me() {
    if (!token()) return null;
    return _get('/api/me');
  }
  async function ladder() {
    return _get('/api/ladder');
  }

  return { serverBase, token, account, isSignedIn, signup, login, logout, me, ladder };
})();
