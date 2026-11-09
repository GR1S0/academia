// Opening the installed app with a code, like SideQuest and T-Minus. accesso.json (written by
// standalone/cifra.mjs) holds the data repository and GitHub key, AES-GCM
// encrypted with a random key; that key is itself encrypted with the 8-digit
// code (PBKDF2, 600 000 rounds). After the first unlock the device chooses:
// Face ID / fingerprint (a passkey whose PRF secret wraps the key on the device),
// stay unlocked, or ask for the code every time.
import { saveGhConfig, setSessionConfig } from './github.js';
import { setupView } from './setup.js';

const BIO = 'ac-bio';
const BIO_WAIT = 'ac-bio-wait';
const ASK = 'ac-ask';
const enc = new TextEncoder();
const PRF_INPUT = enc.encode('Academia sblocco v1');
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const aes = (raw, use) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, use);
const ls = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

export async function unlockView(root, { onUnlock, url = 'accesso.json' } = {}) {
  let lock = null;
  try {
    lock = await fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
  } catch {}
  if (!lock) return setupView(root); // no code set up: paste the key instead
  const n = lock.length || 8;

  root.innerHTML = `
    <header class="masthead">
      <h1 class="wordmark"><img class="mark" src="icons/mark.svg" alt="" width="88" height="88"><span>Academia<i>.</i></span></h1>
      <p class="tagline">I tuoi corsi, una lezione alla volta</p>
    </header>
    <section class="unlock">
      <div data-view="bio" hidden>
        <button class="unlock-go" type="button" data-act="bio">Sblocca con Face ID o impronta</button>
        <button class="unlock-link" type="button" data-act="use-code">Usa il codice</button>
      </div>
      <form data-view="code" autocomplete="off" hidden>
        <label for="ac-code">Inserisci il codice per aprire i tuoi corsi.</label>
        <input id="ac-code" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="${n}" autocomplete="off" aria-label="Codice a ${n} cifre">
        <button class="unlock-go" type="submit">Sblocca</button>
      </form>
      <div data-view="offer" hidden>
        <p data-el="offer-text">Come vuoi aprire Academia la prossima volta, su questo dispositivo?</p>
        <button class="unlock-go" type="button" data-act="bio-on">Con Face ID o impronta</button>
        <button class="unlock-alt" type="button" data-act="remember">Senza codice</button>
        <button class="unlock-link" type="button" data-act="always">Chiedi sempre il codice</button>
      </div>
      <p class="unlock-err" data-el="err" role="alert"></p>
    </section>`;


  const $ = (sel) => root.querySelector(sel);
  const views = [...root.querySelectorAll('[data-view]')];
  const show = (name) => {
    views.forEach((v) => (v.hidden = v.dataset.view !== name));
    if (name === 'code') setTimeout(() => $('#ac-code').focus(), 50);

  };
  const err = (t = '') => ($('[data-el=err]').textContent = t);
  const go = $('form [type=submit]');

  async function configFrom(k) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.payload.iv) }, await aes(k, ['decrypt']), unb64(lock.payload.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function keyFromCode(code) {
    const p = lock.pin;
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(p.salt), iterations: p.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, kek, unb64(p.ct)));
  }

  // For this launch only; the data loads straight away.
  async function openSession(k) {
    setSessionConfig(await configFrom(k));
    onUnlock();
  }

  /* Face ID / fingerprint: the passkey's PRF extension returns a secret that exists
     only after recognition. That secret wraps the key here on the device. */
  async function prfFrom(id) {
    const a = await navigator.credentials.get({
      publicKey: { challenge: rand(32), rpId: location.hostname, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: unb64(id) }], extensions: { prf: { eval: { first: PRF_INPUT } } } },
    });
    const out = a.getClientExtensionResults().prf?.results?.first;
    if (!out) throw new Error('noprf');
    return out;
  }
  async function bioCreate() {
    const c = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Academia', id: location.hostname },
        user: { id: rand(16), name: 'Academia', displayName: 'Academia' },
        challenge: rand(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: PRF_INPUT } } },
      },
    });
    const prf = c.getClientExtensionResults().prf;
    if (!prf || prf.enabled === false) throw new Error('noprf');
    return { id: b64(c.rawId), out: prf.results?.first || null };
  }
  async function bioStore(id, out, k) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(new Uint8Array(out).slice(0, 32), ['encrypt']), k);
    ls.set(BIO, { id, iv: b64(iv), ct: b64(ct) });
    ls.del(BIO_WAIT);
  }
  async function bioUnlock() {
    const bio = ls.get(BIO);
    const out = await prfFrom(bio.id);
    const k = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(bio.iv) }, await aes(new Uint8Array(out).slice(0, 32), ['decrypt']), unb64(bio.ct)));
    await openSession(k);
  }

  let pending = null; // key just unlocked with the code, waiting for the choice
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err();
    const code = $('#ac-code').value.trim();
    if (!code || go.disabled) return;
    go.disabled = true;
    go.textContent = 'Controllo…';
    let k;
    try {
      k = await keyFromCode(code);
    } catch {
      go.disabled = false;
      go.textContent = 'Sblocca';
      $('#ac-code').value = '';
      $('#ac-code').focus();
      return err('Codice sbagliato.');
    }
    if (ls.get(BIO) || ls.get(ASK)) return openSession(k);
    pending = k;
    if (!window.PublicKeyCredential) $('[data-act=bio-on]').hidden = true;
    show('offer');
  });
  // Opens by itself at the last digit.
  $('#ac-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, n);
    if (e.target.value.length === n) $('form').requestSubmit();
  });

  $('[data-act=bio-on]').addEventListener('click', async () => {
    err();
    try {
      const wait = ls.get(BIO_WAIT);
      // On iPhone creating and then reading the passkey can take two separate taps.
      const c = wait ? { id: wait, out: null } : await bioCreate();
      const out =
        c.out ||
        (await prfFrom(c.id).catch((x) => {
          ls.set(BIO_WAIT, c.id);
          throw x;
        }));
      await bioStore(c.id, out, pending);
      openSession(pending);
    } catch (x) {
      if (x.message === 'noprf') {
        ls.del(BIO_WAIT);
        $('[data-el=offer-text]').textContent = 'Face ID e impronta qui non funzionano: la passkey è finita in un gestore che non lo permette. Puoi aprire Academia senza codice su questo dispositivo.';
        $('[data-act=bio-on]').hidden = true;
      } else if (ls.get(BIO_WAIT)) {
        $('[data-act=bio-on]').textContent = 'Conferma Face ID o impronta';
        err('Tocca ancora per confermare.');
      } else {
        err('Passkey non creata. Riprova, oppure scegli "Senza codice".');
      }
    }
  });
  $('[data-act=remember]').addEventListener('click', async () => {
    const { repo, token } = await configFrom(pending);
    saveGhConfig(repo, token);
    onUnlock();
  });
  $('[data-act=always]').addEventListener('click', () => {
    ls.set(ASK, true);
    ls.del(BIO_WAIT);
    openSession(pending);
  });
  $('[data-act=bio]').addEventListener('click', async () => {
    err();
    try {
      await bioUnlock();
    } catch {
      err('Non riconosciuto. Riprova o usa il codice.');
    }
  });
  $('[data-act=use-code]').addEventListener('click', () => {
    err();
    show('code');
  });

  if (ls.get(BIO)) {
    show('bio');
    // Android opens the prompt by itself; Safari wants a tap, so the button stays.
    try {
      await bioUnlock();
    } catch {}
    return;
  }
  show('code');
}
