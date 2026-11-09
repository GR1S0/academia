// Routes (in the address hash, so a lesson can be bookmarked):
//   #/                      the schools
//   #/s/<school>            a school: its classes
//   #/c/<class>/<lesson>    a lesson of a class
// The installed app opens with its code first (unlock.js), then loads the data.
import { initStore } from './store.js';
import { DOC_ID } from './progress.js';
import { homeView, schoolView } from './home.js';
import { courseView } from './course.js';
import { unlockView } from './unlock.js';

const root = document.getElementById('app');
let view = null; // { kind, courseId, cleanup, show }

async function route() {
  const [, kind, courseId, lessonId] = (location.hash.replace(/^#/, '') || '/').split('/');
  if (kind === 'c' && courseId) {
    if (view?.kind === 'course' && view.courseId === courseId) return view.show(lessonId);
    view?.cleanup?.();
    view = { kind: 'course', courseId };
    Object.assign(view, await courseView(root, courseId, lessonId));
    return;
  }
  view?.cleanup?.();
  window.scrollTo(0, 0);
  document.title = 'Academia';
  if (kind === 's' && courseId) view = { kind: 'school', cleanup: await schoolView(root, courseId) };
  else view = { kind: 'home', cleanup: await homeView(root) };
}

async function start() {
  root.innerHTML = '<p class="loading">Apro Academia…</p>';
  const mode = await initStore([DOC_ID]);
  if (mode === 'setup') return unlockView(root, { onUnlock: start });
  addEventListener('hashchange', route);
  route();
}
start();
