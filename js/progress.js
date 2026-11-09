// Progress through the courses, one document for all of them:
// { courses: { <course id>: { done: { <lesson id>: <ISO date> }, last: <lesson id> } } }
import { store } from './store.js';

const DOC = 'progress';

function data() {
  return store.get(DOC) || { courses: {} };
}

function of(courseId) {
  return data().courses[courseId] || { done: {}, last: null };
}

function save(courseId, entry) {
  const d = data();
  d.courses = { ...d.courses, [courseId]: entry };
  store.set(DOC, d);
}

export const isDone = (courseId, lessonId) => Boolean(of(courseId).done[lessonId]);

export function toggleDone(courseId, lessonId) {
  const e = of(courseId);
  const done = { ...e.done };
  if (done[lessonId]) delete done[lessonId];
  else done[lessonId] = new Date().toISOString();
  save(courseId, { ...e, done });
  return Boolean(done[lessonId]);
}

export function setLast(courseId, lessonId) {
  const e = of(courseId);
  if (e.last !== lessonId) save(courseId, { ...e, last: lessonId });
}

export const lastLesson = (courseId) => of(courseId).last;

// Share of lessons done, counting only lessons that still exist in the course.
export function percent(courseId, lessonIds) {
  if (!lessonIds.length) return 0;
  const done = of(courseId).done;
  return Math.round((lessonIds.filter((id) => done[id]).length / lessonIds.length) * 100);
}

export const doneCount = (courseId, lessonIds) => lessonIds.filter((id) => of(courseId).done[id]).length;

export const DOC_ID = DOC;
