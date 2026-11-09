// A course, as in a classroom: the index of sections and lessons on the side,
// the lesson in the middle (video, text, "completata", previous / next).
// On a phone the index is a sheet that opens from the "Indice" button.
import { getCourse, getSchool, lessonsOf } from './catalog.js';
import { isDone, toggleDone, setLast, percent, doneCount } from './progress.js';
import { store } from './store.js';
import { resumeLesson } from './home.js';
import { lessonBlocks } from './blocks.js';
import { esc, duration, videoEmbed, hue, ICON } from './util.js';

export async function courseView(root, courseId, lessonId) {
  root.className = 'classroom';
  root.innerHTML = '<p class="loading">Apro il corso…</p>';
  let course;
  try {
    course = await getCourse(courseId);
  } catch {
    course = null;
  }
  if (!course) {
    root.className = 'home';
    root.innerHTML = `<p class="empty">Classe non trovata. <a href="#/">Torna alle scuole</a></p>`;
    return { cleanup() {}, show() {} };
  }

  // Back goes to the class's school.
  const school = course.school ? await getSchool(course.school).catch(() => null) : null;
  const backHref = school ? `#/s/${esc(school.id)}` : '#/';
  const backLabel = school ? esc(school.name) : 'Scuole';

  const all = lessonsOf(course);
  const ids = () => all.map((l) => l.id);
  let current = null;
  const open = new Set();

  root.style.setProperty('--h', hue(course.id));
  root.innerHTML = `
    <aside class="index" aria-label="Indice del corso">
      <div class="index-head">
        <a class="back" href="${backHref}">${ICON.back}<span>${backLabel}</span></a>
        <button class="icon-btn index-close" type="button" data-act="close" aria-label="Chiudi indice">${ICON.close}</button>
      </div>
      <h1 class="index-title">${esc(course.title)}</h1>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Completamento del corso"><i></i></div>
      <p class="bar-label" data-el="pct"></p>
      <nav class="sections" data-el="sections"></nav>
    </aside>
    <div class="scrim" data-act="close" hidden></div>
    <main class="lesson" data-el="lesson"></main>`;

  const $ = (s) => root.querySelector(s);
  const index = $('.index');
  const scrim = $('.scrim');

  function setIndexOpen(on) {
    index.classList.toggle('open', on);
    scrim.hidden = !on;
    document.body.classList.toggle('locked', on);
    // Only the index scrolls (scrollIntoView would also shift the sliding sheet).
    const cur = on && index.querySelector('.lesson-link.current');
    if (cur && cur.offsetTop + cur.offsetHeight > index.clientHeight) index.scrollTop = cur.offsetTop - index.clientHeight / 2 + cur.offsetHeight / 2;
  }

  function renderProgress() {
    const pct = percent(course.id, ids());
    $('.index .bar i').style.width = `${pct}%`;
    $('.index .bar').setAttribute('aria-valuenow', pct);
    $('[data-el=pct]').innerHTML = `<b>${pct}%</b> · ${doneCount(course.id, ids())} di ${all.length} completate`;
  }

  function renderIndex() {
    $('[data-el=sections]').innerHTML = course.sections
      .map((s) => {
        const sIds = s.lessons.map((l) => l.id);
        const done = doneCount(course.id, sIds);
        const isOpen = open.has(s.id);
        return `
        <section class="section ${isOpen ? 'open' : ''} ${done === sIds.length ? 'complete' : ''}">
          <button class="section-head" type="button" data-sec="${esc(s.id)}" aria-expanded="${isOpen}">
            <span class="chev">${ICON.chevron}</span>
            <span class="section-title">${esc(s.title)}</span>
            <span class="section-count">${done}/${sIds.length}</span>
          </button>
          <ol class="lessons" ${isOpen ? '' : 'hidden'}>
            ${s.lessons
              .map(
                (l) => `
              <li><a class="lesson-link ${l.id === current?.id ? 'current' : ''} ${isDone(course.id, l.id) ? 'done' : ''}" href="#/c/${esc(course.id)}/${esc(l.id)}" ${l.id === current?.id ? 'aria-current="page"' : ''}>
                <span class="tick">${ICON.check}</span>
                <span class="lesson-name">${esc(l.title)}</span>
                <span class="lesson-min">${l.video ? (l.minutes ? `${l.minutes}′` : ICON.play) : ICON.text}</span>
              </a></li>`
              )
              .join('')}
          </ol>
        </section>`;
      })
      .join('');
    renderProgress();
  }

  function video(l) {
    const src = videoEmbed(l.video);
    if (!src) return l.video ? `<p class="callout note"><a href="${esc(l.video)}" target="_blank" rel="noopener">Apri il video</a></p>` : '';
    return `<div class="player"><iframe src="${esc(src)}" title="${esc(l.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  function doneButton(l) {
    const d = isDone(course.id, l.id);
    return `<button class="done-btn ${d ? 'on' : ''}" type="button" data-act="done" aria-pressed="${d}">${ICON.check}<span>${d ? 'Completata' : 'Segna come completata'}</span></button>`;
  }

  function renderLesson() {
    const l = current;
    const i = all.findIndex((x) => x.id === l.id);
    const prev = all[i - 1];
    const next = all[i + 1];
    const link = (x, label, cls) =>
      x ? `<a class="step ${cls}" href="#/c/${esc(course.id)}/${esc(x.id)}"><small>${label}</small><span>${esc(x.title)}</span></a>` : '<span></span>';
    $('[data-el=lesson]').innerHTML = `
      <div class="lesson-bar">
        <a class="back" href="${backHref}">${ICON.back}<span>${backLabel}</span></a>
        <button class="index-btn" type="button" data-act="index">${ICON.list}<span>Indice</span><b>${percent(course.id, ids())}%</b></button>
      </div>
      ${video(l)}
      <header class="lesson-head">
        <p class="crumb">${esc(l.section.title)} · lezione ${i + 1} di ${all.length}${l.minutes ? ` · ${duration(l.minutes)}` : ''}</p>
        <h2>${esc(l.title)}</h2>
        ${doneButton(l)}
      </header>
      <article class="prose">${l.body ? lessonBlocks(l.body) : l.video ? '' : '<p class="muted">Questa lezione è vuota.</p>'}</article>
      <nav class="steps" aria-label="Lezioni vicine">${link(prev, 'Precedente', 'prev')}${link(next, 'Successiva', 'next')}</nav>`;
  }

  function refreshDone() {
    const btn = root.querySelector('.done-btn');
    if (btn) btn.outerHTML = doneButton(current);
    const b = root.querySelector('.index-btn b');
    if (b) b.textContent = `${percent(course.id, ids())}%`;
    renderIndex();
  }

  function show(id) {
    const target = all.find((l) => l.id === id) || all.find((l) => l.id === resumeLesson(course)) || all[0];
    const changed = target.id !== current?.id;
    current = target;
    open.add(current.section.id);
    setLast(course.id, current.id);
    renderIndex();
    if (changed) {
      renderLesson();
      window.scrollTo(0, 0);
    }
    setIndexOpen(false);
    document.title = `${current.title} · Academia`;
  }

  root.addEventListener('click', (e) => {
    const sec = e.target.closest('[data-sec]');
    if (sec) {
      const id = sec.dataset.sec;
      open.has(id) ? open.delete(id) : open.add(id);
      renderIndex();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'index') setIndexOpen(true);
    else if (act === 'close') setIndexOpen(false);
    else if (act === 'sec-open') {
      // From the outline: open that section and bring it into view.
      const d = root.querySelector(`details.block[data-i="${e.target.closest('[data-i]').dataset.i}"]`);
      if (d) {
        d.open = true;
        d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (act === 'sec-all') {
      const all = [...root.querySelectorAll('details.block')];
      const open = all.some((d) => !d.open);
      all.forEach((d) => (d.open = open));
      e.target.textContent = open ? 'Chiudi tutto' : 'Apri tutto';
    } else if (act === 'done') {
      toggleDone(course.id, current.id);
      refreshDone();
    }
  });
  const onKey = (e) => e.key === 'Escape' && setIndexOpen(false);
  document.addEventListener('keydown', onKey);

  // Progress changed on another device: refresh the ticks, keep the video playing.
  const offRemote = store.onRemote(refreshDone);

  show(lessonId);
  return {
    show,
    cleanup() {
      offRemote();
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('locked');
      root.style.removeProperty('--h');
    },
  };
}
