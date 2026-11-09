// The schools and their classes. They are paid content of their authors, so they
// never ship with the public app: in the installed app they come from the private
// data repository (courses/index.json: the schools, each with its classes;
// courses/<class id>.json: a class's sections and lessons), kept on the device after
// the first download so they open offline; in local development they load from
// the project's courses/ folder.
import { store } from './store.js';
import { ghConfig, github } from './github.js';

const CACHE = 'ac-courses-2'; // -2: the catalogue became schools → classes
const courses = {};

function cached(key) {
  try {
    return JSON.parse(localStorage.getItem(`${CACHE}:${key}`));
  } catch {
    return null;
  }
}
function keep(key, value) {
  try {
    localStorage.setItem(`${CACHE}:${key}`, JSON.stringify(value));
  } catch {}
}

async function read(path) {
  if (store.mode() === 'github') return github(ghConfig()).readJSON(path);
  const r = await fetch(new URL(`../${path}`, import.meta.url), { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

// Shows the copy on the device at once and refreshes it in the background;
// `onFresh` runs if the downloaded version differs.
async function load(path, onFresh) {
  const old = cached(path);
  const fresh = read(path).then((data) => {
    if (data && JSON.stringify(data) !== JSON.stringify(old)) {
      keep(path, data);
      if (old) onFresh?.(data);
    }
    return data;
  });
  if (old) {
    fresh.catch(() => {});
    return old;
  }
  return fresh;
}

// [{ id, name, author, summary, logo, classes: [{ id, title, summary, cover, lessons, minutes, state }] }]
// state: 'ready' (imported, opens here), 'open' (on Skool, not imported yet), 'locked', 'soon'.
export async function listSchools(onFresh) {
  const list = await load('courses/index.json', onFresh);
  return Array.isArray(list) ? list.filter((s) => Array.isArray(s.classes)) : [];
}

export async function getSchool(id) {
  return (await listSchools()).find((s) => s.id === id) || null;
}

export async function getCourse(id, onFresh) {
  if (courses[id]) return courses[id];
  const c = await load(`courses/${id}.json`, (data) => {
    courses[id] = data;
    onFresh?.(data);
  });
  if (c) courses[id] = c;
  return c;
}

export const lessonsOf = (course) => course.sections.flatMap((s) => s.lessons.map((l) => ({ ...l, section: s })));
