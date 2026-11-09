// Home: the schools. A school: its classes, each with its art, its progress and a
// way back to where you left off. (School → classes → sections → lessons.)
import { listSchools, getSchool, getCourse, lessonsOf } from './catalog.js';
import { percent, doneCount, lastLesson, isDone } from './progress.js';
import { store } from './store.js';
import { esc, duration, ICON } from './util.js';

function statusChip() {
  const s = store.status();
  return `<span class="status status-${s.state}" data-el="status">${esc(s.text)}</span>`;
}

const topbar = () => `
  <header class="topbar">
    <a class="wordmark" href="#/"><img class="mark" src="icons/mark.svg" alt="" width="36" height="36"><span>Academia<i>.</i></span></a>
    ${statusChip()}
  </header>`;

const STATE = { open: 'Da importare', locked: 'Bloccata su Skool', soon: 'In arrivo' };

// Where "Continua" goes: the last lesson opened, or else the first not yet done.
export function resumeLesson(course) {
  const all = lessonsOf(course);
  const last = lastLesson(course.id);
  if (last && all.some((l) => l.id === last)) return last;
  return (all.find((l) => !isDone(course.id, l.id)) || all[0])?.id;
}

function classCard(entry, course) {
  const ready = entry.state === 'ready' && course;
  const ids = ready ? lessonsOf(course).map((l) => l.id) : [];
  const pct = ready ? percent(entry.id, ids) : 0;
  const done = ready ? doneCount(entry.id, ids) : 0;
  const started = done > 0 || (ready && lastLesson(entry.id));
  const target = ready ? resumeLesson(course) : null;
  const cover = entry.cover
    ? `<img class="cover" src="${esc(entry.cover)}" alt="" loading="lazy">`
    : `<div class="cover cover-blank" aria-hidden="true"><span>${entry.lessons} lezioni</span></div>`;
  const body = `
      ${cover}
      <div class="course-meta">
        <h2>${esc(entry.title)}</h2>
        ${entry.summary ? `<p class="summary">${esc(entry.summary)}</p>` : ''}
        <p class="facts">${entry.lessons} lezioni${entry.minutes ? ` · ${duration(entry.minutes)} di video` : ''}</p>
        ${
          ready
            ? `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Completamento"><i style="width:${pct}%"></i></div>
        <p class="bar-label"><b>${pct}%</b> · ${done} di ${ids.length} completate</p>
        <span class="cta">${started ? 'Continua' : 'Inizia'}</span>`
            : `<span class="tag">${STATE[entry.state] || 'Non disponibile'}</span>`
        }
      </div>`;
  return ready
    ? `<a class="course-card" href="#/c/${esc(entry.id)}${target ? `/${esc(target)}` : ''}">${body}</a>`
    : `<div class="course-card off" aria-disabled="true">${body}</div>`;
}

// Progress of a whole school: the lessons done across its imported classes.
function schoolProgress(classes) {
  let all = 0;
  let done = 0;
  for (const c of classes) {
    if (!c) continue;
    const ids = lessonsOf(c).map((l) => l.id);
    all += ids.length;
    done += doneCount(c.id, ids);
  }
  return { all, done, pct: all ? Math.round((done / all) * 100) : 0 };
}

function view(root, render) {
  let alive = true;
  const run = () => alive && render(() => alive, run);
  run();
  const offStatus = store.onStatus((s) => {
    const el = root.querySelector('[data-el=status]');
    if (el) {
      el.className = `status status-${s.state}`;
      el.textContent = s.text;
    }
  });
  const offRemote = store.onRemote(run);
  return () => {
    alive = false;
    offStatus();
    offRemote();
  };
}

const readyClasses = (school) =>
  Promise.all(school.classes.map((c) => (c.state === 'ready' ? getCourse(c.id).catch(() => null) : null)));

export async function homeView(root) {
  root.className = 'home';
  root.innerHTML = `${topbar()}<section class="schools" aria-label="Scuole"><p class="loading">Carico le scuole…</p></section>`;
  const list = root.querySelector('.schools');
  return view(root, async (alive, rerun) => {
    let schools;
    try {
      schools = await listSchools(() => alive() && rerun());
    } catch {
      list.innerHTML = '<p class="empty">Non riesco a scaricare le scuole. Controlla la connessione e riapri l\'app.</p>';
      return;
    }
    if (!alive()) return;
    if (!schools.length) {
      list.innerHTML = '<p class="empty">Ancora nessuna scuola.</p>';
      return;
    }
    const full = await Promise.all(schools.map(readyClasses));
    if (!alive()) return;
    list.innerHTML = schools
      .map((s, i) => {
        const p = schoolProgress(full[i]);
        return `
        <a class="school-card" href="#/s/${esc(s.id)}">
          ${s.logo ? `<img class="school-logo" src="${esc(s.logo)}" alt="" loading="lazy">` : ''}
          <div class="school-meta">
            <h2>${esc(s.name)}${s.author ? ` <span class="by">di ${esc(s.author)}</span>` : ''}</h2>
            <p class="facts">${s.classes.length} classi${p.all ? ` · <b>${p.pct}%</b> completato` : ''}</p>
          </div>
          <span class="chev">${ICON.chevron}</span>
        </a>`;
      })
      .join('');
  });
}

export async function schoolView(root, schoolId) {
  root.className = 'home';
  root.innerHTML = `${topbar()}<p class="loading">Apro la scuola…</p>`;
  return view(root, async (alive) => {
    const school = await getSchool(schoolId).catch(() => null);
    if (!alive()) return;
    if (!school) {
      root.innerHTML = `${topbar()}<p class="empty">Scuola non trovata. <a href="#/">Torna alle scuole</a></p>`;
      return;
    }
    const full = await readyClasses(school);
    if (!alive()) return;
    const p = schoolProgress(full);
    document.title = `${school.name} · Academia`;
    root.innerHTML = `
      ${topbar()}
      <a class="back" href="#/">${ICON.back}<span>Scuole</span></a>
      <header class="school-head">
        ${school.logo ? `<img class="school-logo" src="${esc(school.logo)}" alt="" width="72" height="72">` : ''}
        <h1>${esc(school.name)}</h1>
        <div class="big-pct" aria-label="Completamento della scuola">
          <b>${p.pct}%</b>
          <span>completato</span>
        </div>
      </header>
      <div class="school-bar">
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><i style="width:${p.pct}%"></i></div>
        <p class="bar-label">${p.done} di ${p.all} lezioni · ${school.classes.length} classi</p>
      </div>
      <section class="courses" aria-label="Classi">${school.classes.map((c, i) => classCard(c, full[i])).join('')}</section>`;
  });
}
