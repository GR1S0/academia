// Where Academia keeps its data (the progress through the courses):
// - on claude.ai: the page's database (ac/<id>);
// - in the installed app (GitHub Pages): a private GitHub repository
//   (data/<id>.json), with a local copy so it opens at once and works offline;
// - anywhere else (local development): this browser's localStorage.
// Phone and computer stay in sync in the first two.
import { ghConfig, github } from './github.js';

const COLLECTION = 'ac';
const LOCAL = 'academia:';
const GH_CACHE = 'ac-gh-cache';
const GH_PULL_EVERY = 45000;

const docs = {};
const lastJSON = {}; // last JSON known to match the server, per doc
const pending = {};
const busy = {};
const remoteListeners = new Set();
const statusListeners = new Set();
let db = null;
let gh = null;
let ghState = { shas: {}, dirty: [] };
let status = { state: 'loading', text: 'Collegamento…' };
let mode = 'loading';

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function setStatus(state, text) {
  status = { state, text };
  statusListeners.forEach((fn) => fn(status));
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.code !== 'unavailable') throw e;
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
    return fn();
  }
}

// Changes made on another device. The doc object is updated in place, so a
// view holding a reference to it sees the new data.
function applyRemote(id, data) {
  const cur = docs[id];
  if (cur) {
    Object.keys(cur).forEach((k) => !(k in data) && delete cur[k]);
    Object.assign(cur, clone(data));
  } else {
    docs[id] = clone(data);
  }
  // A copy: a listener that registers another one must not be called in a loop.
  [...remoteListeners].forEach((fn) => fn(id));
}

// Resolves to 'claude', 'github', 'local', or 'setup' (the installed app before
// it is linked to its data repository).
export async function initStore(ids) {
  try {
    db = typeof window.claude?.use === 'function' ? await window.claude.use('db') : null;
  } catch {
    db = null;
  }
  if (db) {
    try {
      for (const id of ids) {
        const snap = await withRetry(() => db.doc(`${COLLECTION}/${id}`).get());
        docs[id] = snap.exists ? clone(snap.data()) : null;
        if (snap.exists) lastJSON[id] = JSON.stringify(snap.data());
      }
      setStatus('ok', 'Sincronizzato');
      ids.forEach(watch);
      mode = 'claude';
      return mode;
    } catch {
      db = null;
    }
  }
  const cfg = ghConfig();
  if (cfg) {
    gh = github(cfg);
    await startGithub(ids);
    mode = 'github';
    return mode;
  }
  for (const id of ids) {
    try {
      docs[id] = JSON.parse(localStorage.getItem(LOCAL + id));
    } catch {
      docs[id] = null;
    }
  }
  setStatus('local', 'Solo su questo dispositivo');
  // The installable build marks its page (standalone/build_pages.py), whatever its domain.
  mode = document.documentElement.dataset.app === 'standalone' ? 'setup' : 'local';
  return mode;
}

/* ── claude.ai database ── */

function watch(id) {
  db.doc(`${COLLECTION}/${id}`).onSnapshot(
    (snap) => {
      if (!snap.exists || snap.metadata?.hasPendingWrites || pending[id] || busy[id]) return;
      const data = snap.data();
      const json = JSON.stringify(data);
      if (json === lastJSON[id] || json === JSON.stringify(docs[id])) return;
      lastJSON[id] = json;
      applyRemote(id, data);
    },
    (e) => e?.code === 'revoked' && setStatus('err', 'Accesso chiuso: riapri la pagina')
  );
}

async function flush(id) {
  pending[id] = null;
  if (busy[id]) {
    busy[id] = 'again';
    return;
  }
  busy[id] = true;
  const json = JSON.stringify(docs[id]);
  try {
    if (json !== lastJSON[id]) {
      await withRetry(() => db.doc(`${COLLECTION}/${id}`).set(JSON.parse(json)));
      lastJSON[id] = json;
    }
    setStatus('ok', 'Sincronizzato');
  } catch (e) {
    setStatus('err', e?.code === 'revoked' ? 'Accesso chiuso: riapri la pagina' : 'Non salvato: riprovo alla prossima modifica');
  }
  const again = busy[id] === 'again';
  busy[id] = false;
  if (again) flush(id);
}

/* ── GitHub repository ── */

function ghPersist() {
  try {
    localStorage.setItem(GH_CACHE, JSON.stringify({ docs, ...ghState }));
  } catch {}
}

function ghFailed(e) {
  if (e.code === 'auth') setStatus('err', 'GitHub non accetta la chiave: ricollega i dati');
  else if (e.code === 'offline') setStatus('local', 'Offline: salvo appena torna la rete');
  else setStatus('err', 'GitHub non risponde: riprovo tra poco');
}

let pulling = null;
function ghPull(ids) {
  if (pulling) return pulling;
  pulling = (async () => {
    for (const id of ids) {
      if (ghState.dirty.includes(id)) continue; // our own change goes up first
      const remote = await gh.get(id);
      if (remote.sha === ghState.shas[id]) continue;
      ghState.shas[id] = remote.sha;
      if (remote.data) applyRemote(id, remote.data);
    }
    ghPersist();
    if (!ghState.dirty.length) setStatus('ok', 'Sincronizzato');
  })()
    .catch(ghFailed)
    .finally(() => {
      pulling = null;
    });
  return pulling;
}

let pushTimer = null;
let pushing = null;
function ghSchedulePush(ms = 800) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(ghPush, ms);
}

function ghPush() {
  if (pushing) return pushing.then(() => ghSchedulePush(0));
  pushing = (async () => {
    for (const id of [...ghState.dirty]) {
      let sha = ghState.shas[id];
      for (let tries = 0; tries < 3; tries++) {
        try {
          ghState.shas[id] = await gh.put(id, docs[id], sha);
          ghState.dirty = ghState.dirty.filter((x) => x !== id);
          break;
        } catch (e) {
          // Another device wrote meanwhile: this change is the newest, so it goes on top.
          if (e.code === 'conflict') sha = (await gh.get(id)).sha;
          else throw e;
        }
      }
    }
    ghPersist();
    setStatus('ok', 'Sincronizzato');
  })()
    .catch((e) => {
      ghFailed(e);
      if (e.code !== 'auth') ghSchedulePush(15000);
    })
    .finally(() => {
      pushing = null;
    });
  return pushing;
}

async function startGithub(ids) {
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(GH_CACHE));
  } catch {}
  if (cached) {
    ids.forEach((id) => (docs[id] = cached.docs?.[id] ?? null));
    ghState = { shas: cached.shas || {}, dirty: cached.dirty || [] };
    ghPull(ids); // show the local copy now, catch up in the background
  } else {
    ids.forEach((id) => (docs[id] = null));
    setStatus('busy', 'Scarico i dati…');
    await ghPull(ids);
  }
  if (ghState.dirty.length) ghSchedulePush(0);
  const again = () => document.visibilityState === 'visible' && ghPull(ids);
  document.addEventListener('visibilitychange', again);
  addEventListener('online', () => {
    again();
    ghSchedulePush(0);
  });
  setInterval(again, GH_PULL_EVERY);
  gh.loadFonts().catch(() => {});
}

export const store = {
  get: (id) => docs[id] ?? null,

  // Makes `data` the live object for this doc (a view's own state object).
  adopt(id, data) {
    docs[id] = data;
  },

  set(id, data) {
    docs[id] = data;
    if (gh) {
      if (!ghState.dirty.includes(id)) ghState.dirty.push(id);
      ghPersist();
      setStatus('busy', 'Salvataggio…');
      ghSchedulePush();
      return;
    }
    if (!db) {
      try {
        localStorage.setItem(LOCAL + id, JSON.stringify(data));
      } catch {}
      return;
    }
    setStatus('busy', 'Salvataggio…');
    clearTimeout(pending[id]);
    pending[id] = setTimeout(() => flush(id), 400);
  },

  onRemote(fn) {
    remoteListeners.add(fn);
    return () => remoteListeners.delete(fn);
  },

  mode: () => mode,
  status: () => status,
  onStatus(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },
};
