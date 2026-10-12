/** A theme-neutral browser controller for compiled education worlds. */
import { renderMarkdownBlockHtml } from '@red-cup-engineering/markdown-engineering-services-section/render-markdown-block-html';
import { stripExerciseFences } from './markdown.js';
import { hydrateExercises, gradeExercise, exercisesByRoom } from '../../src/checker.mjs';
import { reviewCard, recallProbability, STAGE_CUTS } from '../../src/srs.mjs';
import { buildGateSession, buildReviewSession } from '../../src/session.mjs';
import { recallMastery, roomMastery } from '../../src/mastery.mjs';
import * as state from './state.js';

const SEED_DEFAULTS = { stability: 0, difficulty: 5 }; // pre-first-review placeholder, Lantern's own convention (persistence.mts §1 note)

export function createEducationAppConfig(adapter) {
  if (!adapter?.themeId || !adapter?.worldUrl || !adapter?.checkers || !adapter?.createAnswerForm) {
    throw new TypeError('education adapter needs themeId, worldUrl, checkers, and createAnswerForm');
  }
  return Object.freeze({
    ...adapter,
    exerciseFenceLabels: adapter.exerciseFenceLabels ?? [],
    presentation: { streak: true, halls: true, recallPercent: true, progressCount: false, ...adapter.presentation },
  });
}

export function mountEducationApp({ root = document, adapter: suppliedAdapter }) {
  const adapter = createEducationAppConfig(suppliedAdapter);
  const document = root.ownerDocument ?? root;
  const find = (id) => root.querySelector(`#${id}`);
  const els = {
    loadStatus: find('load-status'),
    roomList: find('room-list'),
    content: find('content-panel'),
    storageStatus: find('storage-status'),
    streak: find('streak-display'),
    btnExport: find('btn-export'),
    btnImport: find('btn-import'),
    fileImport: find('file-import'),
  };
  if (!els.loadStatus || !els.roomList || !els.content) throw new TypeError('education shell needs load-status, room-list, and content-panel');
  const playerHandle = state.createStateStore(adapter.themeId);
  const playerStore = { ...state, loadState: () => playerHandle.load(), saveState: (value) => playerHandle.save(value), replaceState: (value) => playerHandle.replace(value), get mode() { return playerHandle.mode; } };

/** @type {{world: any, byRoom: Map<string, any[]>, exercises: any[]}} */
let world;
let playerState = playerStore.loadState();
let currentRoomId = null;
/** Active exercise session, or null when the content pane is showing a reading pane. */
let session = null; // { roomId, mode: 'gate'|'review', queue, index, retryAnswerCallback }

function today() {
  return playerStore.today();
}

function save() {
  playerStore.saveState(playerState);
  renderStorageStatus();
}

function renderStorageStatus() {
  if (!els.storageStatus) return;
  els.storageStatus.hidden = playerStore.mode === 'persistent';
  els.storageStatus.textContent = 'Progress is session-only on this device. Export your save before leaving.';
}

// ---------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------

async function boot() {
  try {
    const res = await fetch(adapter.worldUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const { exercises, unregisteredKinds } = hydrateExercises(raw.exercises, adapter.checkers);
    if (unregisteredKinds.length > 0) throw new Error(`The course has unsupported exercise kinds: ${unregisteredKinds.join(', ')}`);
    world = { raw, exercises, byRoom: exercisesByRoom(exercises) };
    els.loadStatus.textContent = '';
    renderStorageStatus();
    adapter.mountPresentation?.({ root, onChange: () => { if (session) renderExerciseStep(); } });
    renderRoomList();
    renderStreak();
    const first = pickInitialRoom();
    if (first) openRoom(first);
  } catch (err) {
    els.loadStatus.textContent = `Could not load the course: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function pickInitialRoom() {
  if (currentRoomId && world.raw.rooms.some((r) => r.id === currentRoomId)) return currentRoomId;
  return world.raw.rooms[0]?.id ?? null;
}

// ---------------------------------------------------------------------------------------
// Gate / mastery predicates (mirrors self-education-platform-design.md §4/§5, over local state)
// ---------------------------------------------------------------------------------------

function roomExercises(roomId) {
  return world.byRoom.get(roomId) ?? [];
}

function effectiveState(exerciseId) {
  return playerStore.effectiveExerciseState(playerState, exerciseId, SEED_DEFAULTS);
}

/** A room with zero exercises (the overview room) counts as gated by definition -- there is
 * nothing to pass. */
function roomGatedOnce(roomId) {
  const exs = roomExercises(roomId);
  if (exs.length === 0) return true;
  return exs.every((ex) => effectiveState(ex.id).lastReviewedAt !== undefined);
}

function roomUnlocked(roomId) {
  const incoming = world.raw.doors.filter((d) => d.to === roomId && d.weight === 'hard');
  if (incoming.length === 0) return true;
  return incoming.every((d) => roomGatedOnce(d.from));
}

function roomRecall(roomId, now) {
  const exs = roomExercises(roomId);
  const inputs = exs.map((ex) => {
    const s = effectiveState(ex.id);
    return { stability: s.stability, lastReviewedAt: s.lastReviewedAt };
  });
  return recallMastery(inputs, now);
}

// ---------------------------------------------------------------------------------------
// Room list
// ---------------------------------------------------------------------------------------

function renderRoomList() {
  els.roomList.innerHTML = '';
  const now = today();
  for (const room of world.raw.rooms) {
    const unlocked = roomUnlocked(room.id);
    const gated = roomGatedOnce(room.id);
    const recall = roomRecall(room.id, now);
    const mastered = roomMastery(recall, gated) && roomExercises(room.id).length > 0;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room-item' + (unlocked ? ' unlocked' : '') + (mastered ? ' mastered' : '');
    btn.disabled = !unlocked;
    btn.setAttribute('aria-current', String(room.id === currentRoomId));
    btn.title = unlocked ? room.title : 'Locked -- clear the previous room first';

    const dot = document.createElement('span');
    dot.className = 'room-dot';
    dot.setAttribute('aria-hidden', 'true');
    btn.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'room-title';
    label.textContent = room.title;
    btn.appendChild(label);

    if ((adapter.presentation.recallPercent || adapter.presentation.progressCount) && unlocked && roomExercises(room.id).length > 0) {
      const m = document.createElement('span');
      m.className = 'room-mastery';
      m.textContent = adapter.presentation.recallPercent
        ? (recall === undefined ? '' : `${Math.round(recall * 100)}%`)
        : `${roomExercises(room.id).filter((exercise) => effectiveState(exercise.id).lastReviewedAt !== undefined).length}/${roomExercises(room.id).length}`;
      btn.appendChild(m);
    }

    btn.addEventListener('click', () => {
      if (!unlocked) return;
      openRoom(room.id);
    });
    els.roomList.appendChild(btn);
  }

  const reviewCount = dueReviewCandidates().length;
  const reviewBtn = document.createElement('button');
  reviewBtn.type = 'button';
  reviewBtn.className = 'room-item unlocked';
  reviewBtn.setAttribute('aria-current', String(currentRoomId === '__review__'));
  reviewBtn.innerHTML = `<span class="room-dot" aria-hidden="true"></span><span class="room-title">Review queue</span><span class="room-mastery">${reviewCount}</span>`;
  reviewBtn.addEventListener('click', () => openReview());
  els.roomList.appendChild(reviewBtn);
}

// ---------------------------------------------------------------------------------------
// Reading pane
// ---------------------------------------------------------------------------------------

function openRoom(roomId) {
  currentRoomId = roomId;
  session = null;
  renderRoomList();
  const room = world.raw.rooms.find((r) => r.id === roomId);
  const exs = roomExercises(roomId);
  const hall = adapter.presentation.halls ? world.raw.halls?.find((h) => h.rooms.includes(roomId)) : null;

  els.content.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = room.title;
  if (hall) {
    const badge = document.createElement('span');
    badge.className = 'hall-badge';
    badge.textContent = hall.stable ? 'hall: stable' : 'hall: not yet braced';
    h2.appendChild(badge);
  }
  els.content.appendChild(h2);

  const body = document.createElement('div');
  body.innerHTML = renderMarkdownBlockHtml(stripExerciseFences(room.body, adapter.exerciseFenceLabels), { headingOffset: 1, emptyHtml: "" });
  els.content.appendChild(body);

  const gated = roomGatedOnce(roomId);
  if (exs.length === 0) {
    const next = world.raw.doors.find((d) => d.from === roomId)?.to;
    if (next) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.type = 'button';
      btn.textContent = 'Begin →';
      btn.addEventListener('click', () => openRoom(next));
      els.content.appendChild(btn);
    }
    return;
  }

  const kinds = new Set(exs.map((e) => e.kind)).size;
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.type = 'button';
  btn.textContent = gated ? `Practice again (${exs.length} exercises, ${kinds} kinds)` : `Begin exercises (${exs.length}, ${kinds} kinds)`;
  btn.addEventListener('click', () => startGate(roomId));
  els.content.appendChild(btn);
}

// ---------------------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------------------

function renderStreak() {
  if (!adapter.presentation.streak || !els.streak) return;
  const s = playerState.streak;
  const atRisk = playerStore.streakAtRisk(s, today());
  els.streak.textContent = s.current > 0
    ? `🔥 ${s.current}-day streak${atRisk ? ' (review today to keep it)' : ''} · ${s.freezeTokens} freeze token${s.freezeTokens === 1 ? '' : 's'}`
    : 'No streak yet -- pass an exercise to start one.';
}

function markActivity() {
  playerState = { ...playerState, streak: playerStore.touchStreak(playerState.streak, today()) };
  save();
  renderStreak();
}

// ---------------------------------------------------------------------------------------
// Export / import (self-education-platform-design.md §7's documented seam)
// ---------------------------------------------------------------------------------------

els.btnExport?.addEventListener('click', () => {
  const blob = new Blob([playerStore.exportStateJson(playerState)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${adapter.themeId}-save.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

els.btnImport?.addEventListener('click', () => els.fileImport?.click());
els.fileImport?.addEventListener('change', async () => {
  const file = els.fileImport.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = playerStore.importStateJson(text);
    if (!imported || imported.themeId !== adapter.themeId) throw new Error('That file is not a valid save for this course. Your current progress is unchanged.');
    playerState = imported;
    playerStore.replaceState(playerState);
    renderStorageStatus();
    renderStreak();
    renderRoomList();
    if (currentRoomId) openRoom(currentRoomId);
  } catch (err) {
    alert(`Could not import save: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    els.fileImport.value = '';
  }
});

// ---------------------------------------------------------------------------------------
// Sessions: gate (learning pass) + review (honest recall pass)
// ---------------------------------------------------------------------------------------

function dueReviewCandidates() {
  const now = today();
  const candidates = world.exercises
    .map((ex) => {
      const s = effectiveState(ex.id);
      if (s.lastReviewedAt === undefined) return null;
      return { exercise: ex, stability: s.stability, lastReviewedAt: s.lastReviewedAt };
    })
    .filter(Boolean);
  return buildReviewSession(candidates, now, seedFor('review'), undefined).filter((c) => c.R < STAGE_CUTS.full);
}

function seedFor(tag) {
  // App-level seed choice, not a kernel purity concern (buildGateSession/buildReviewSession are
  // pure given whatever seed they're handed) -- a fresh seed per session start, so repeat visits
  // to the same room don't present exercises in the same order every time.
  let h = 2166136261;
  const s = `${tag}:${Date.now()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function startGate(roomId) {
  const exs = roomExercises(roomId);
  const queue = buildGateSession(roomId, exs, seedFor(roomId)).map((exercise) => ({ exercise, mode: 'gate' }));
  session = { roomId, mode: 'gate', queue, index: 0 };
  renderExerciseStep();
}

function openReview() {
  currentRoomId = '__review__';
  session = null;
  renderRoomList();
  const due = dueReviewCandidates();
  els.content.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = 'Review queue';
  els.content.appendChild(h2);
  const p = document.createElement('p');
  p.textContent = due.length === 0
    ? 'Nothing is scheduled for review right now.'
    : `${due.length} exercise${due.length === 1 ? '' : 's'} scheduled for review.`;
  els.content.appendChild(p);
  if (due.length === 0) return;
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.type = 'button';
  btn.textContent = `Start review (${due.length})`;
  btn.addEventListener('click', () => {
    const queue = due.map((c) => ({ exercise: c.exercise, mode: 'review' }));
    session = { roomId: '__review__', mode: 'review', queue, index: 0 };
    renderExerciseStep();
  });
  els.content.appendChild(btn);
}

function renderExerciseStep() {
  const { queue, index } = session;
  const step = queue[index];
  els.content.innerHTML = '';

  const strip = document.createElement('div');
  strip.className = 'progress-strip';
  queue.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = 'progress-dot' + (i < index ? ' done' : i === index ? ' current' : '');
    strip.appendChild(d);
  });
  els.content.appendChild(strip);

  const caption = adapter.renderExerciseCaption?.(document, step.exercise);
  if (caption) els.content.appendChild(caption);

  const promptEl = document.createElement('p');
  promptEl.className = 'exercise-prompt';
  promptEl.textContent = step.exercise.prompt;
  els.content.appendChild(promptEl);

  const specList = adapter.renderSpecContext?.(document, step.exercise);
  if (specList) els.content.appendChild(specList);

  const { form: answerFields, readAnswer } = adapter.createAnswerForm(document, step.exercise);
  const form = document.createElement('form');
  form.appendChild(answerFields);
  els.content.appendChild(form);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'primary';
  submitBtn.textContent = 'Check';
  form.appendChild(submitBtn);

  form.querySelector('input, select, textarea')?.focus();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    let answer;
    try {
      answer = readAnswer();
    } catch (err) {
      showVerdict({ pass: false, diagnosis: err instanceof Error ? err.message : String(err) }, step, () => {});
      return;
    }
    const verdict = gradeExercise(step.exercise, answer);
    handleVerdict(verdict, step);
  });
}

function handleVerdict(verdict, step) {
  showVerdict(verdict, step, (grade) => applyReview(step.exercise, grade));
}

function showVerdict(verdict, step, onGraded) {
  // Remove a prior verdict block if the player is retrying.
  els.content.querySelectorAll('.verdict, .grade-row').forEach((n) => n.remove());
  const box = document.createElement('div');
  box.className = 'verdict ' + (verdict.pass ? 'pass' : 'fail');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  const strong = document.createElement('strong');
  strong.textContent = verdict.pass ? 'Correct.' : 'Not quite.';
  const p = document.createElement('p');
  p.textContent = verdict.diagnosis;
  box.appendChild(strong);
  box.appendChild(p);
  els.content.appendChild(box);

  if (verdict.pass) {
    const grades = document.createElement('div');
    grades.className = 'grade-row';
    let graded = false;
    for (const [grade, cls, label] of [[2, 'grade-hard', 'Hard'], [3, 'grade-good', 'Good'], [4, 'grade-easy', 'Easy']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `grade ${cls}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        if (graded) return;
        graded = true;
        grades.querySelectorAll('button').forEach((button) => { button.disabled = true; });
        onGraded(grade);
      });
      grades.appendChild(b);
    }
    els.content.appendChild(grades);
  } else if (step.mode === 'gate') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => renderExerciseStep());
    els.content.appendChild(retry);
  } else {
    // Review mode, wrong answer: honest recall check, no retry -- record Again and move on.
    const cont = document.createElement('button');
    cont.type = 'button';
    cont.className = 'primary';
    cont.textContent = 'Continue';
    cont.addEventListener('click', () => applyReview(step.exercise, 1));
    els.content.appendChild(cont);
  }
}

function applyReview(exercise, grade) {
  const prior = effectiveState(exercise.id);
  const next = reviewCard(prior, grade, today());
  playerState = playerStore.recordExerciseReview(playerState, exercise.id, next);
  save();
  markActivity();

  session.index += 1;
  if (session.index >= session.queue.length) {
    finishSession();
  } else {
    renderExerciseStep();
  }
}

function finishSession() {
  const { roomId, mode } = session;
  session = null;
  renderRoomList();
  els.content.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = mode === 'gate' ? 'Room cleared' : 'Review complete';
  els.content.appendChild(h2);
  const p = document.createElement('p');
  const recall = roomId === '__review__' ? undefined : roomRecall(roomId, today());
  p.textContent = !adapter.presentation.recallPercent || recall === undefined
    ? 'Nice work.'
    : `Recall mastery for this room: ${Math.round(recall * 100)}%${recall >= STAGE_CUTS.full ? ' (mastered)' : ''}.`;
  els.content.appendChild(p);

  const backBtn = document.createElement('button');
  backBtn.className = 'primary';
  backBtn.type = 'button';
  backBtn.textContent = 'Back to unit';
  backBtn.addEventListener('click', () => {
    const next = roomId !== '__review__' ? world.raw.doors.find((d) => d.from === roomId)?.to : null;
    openRoom(next && roomUnlocked(next) ? next : (roomId !== '__review__' ? roomId : world.raw.rooms[0].id));
  });
  els.content.appendChild(backBtn);
}

boot();
return Object.freeze({ themeId: adapter.themeId, worldUrl: adapter.worldUrl });
}
