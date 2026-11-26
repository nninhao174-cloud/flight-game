// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between five screens: title, help, play, paused and flight over.
// The HUD is DOM text over the canvas; the leaderboard lives in memory for this visit
// only, and the volume slider sets a value the game keeps (there is no audio at all).
//
// ?seed=N fixes the weather and the failure clock. ?shot=title|flight|landing|engine
// (with &seed=N and &scenario=<id>) stages that scene instead of running the loop, paints
// it twice and sets window.__shotReady for a screenshot.
import {
  FLIGHT_SECONDS, LANDING_MAX_ERROR_M, LEADERBOARD_MAX, SCENARIOS, STEP,
} from './config.js';
import { createRandom } from './random.js';
import {
  EVENT_ALL_RINGS, EVENT_CRASH, EVENT_FAILURE, EVENT_FUEL, EVENT_LANDED, EVENT_RESTART,
  EVENT_RING, EVENT_TIMEOUT, createWorld,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_PAUSE, ACTION_RESTART, ACTION_VIEW, createInput,
} from './input.js';
import {
  SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, VIEW_CHASE, VIEW_COCKPIT,
  VIEW_TOWER, createRenderer,
} from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
const scenarioParam = params.get('scenario') || 'mission-1';

function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const $ = (id) => document.getElementById(id);
const hud = {
  alt: $('hud-alt'), spd: $('hud-spd'), hdg: $('hud-hdg'), pos: $('hud-pos'),
  score: $('hud-score'), time: $('hud-time'), throttle: $('hud-throttle'),
  fuel: $('hud-fuel'), fuelText: $('hud-fuel-text'), engine: $('hud-engine'),
  objective: $('hud-objective'), distance: $('hud-distance'), wind: $('hud-wind'),
  vol: $('hud-vol'), horizon: $('att-horizon'), warn: $('warn'),
  warnCount: $('warn-count'), guide: $('guide'), guideDist: $('guide-dist'),
  flash: $('flash'),
};

let scenario = findScenario(scenarioParam);
let world = createWorld(scenario, createRandom(seed));
let renderer;
try {
  renderer = createRenderer(canvas);
} catch {
  $('no-webgl').hidden = false;
  throw new Error('WebGL is not available');
}

let screen = SCREEN_TITLE;
let view = VIEW_COCKPIT;
let volume = 70;
let best = 0;
const board = [];
const touch = { throttleUp: false, throttleDown: false, brake: false };
let flashTimer = 0;
let titleTime = 0;

/** Park the Kestrel on the runway for the title screen's backdrop. */
function parkPlane() {
  const p = world.state.plane;
  p.x = -350; p.y = 2; p.z = 0;
  p.heading = Math.PI / 2; p.pitch = 0; p.roll = 0;
  p.speed = 0; p.throttle = 0;
  world.state.ended = false;
  world.state.crashed = false;
  world.state.landed = false;
  world.state.endReason = '';
}

function fmt(n, digits) {
  return Number(n).toFixed(digits);
}
function knots(ms) { return ms * 1.94384; }
function feet(m) { return m * 3.28084; }
function compass(headingDeg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(headingDeg / 45) % 8];
}
function headingDeg(heading) {
  return ((heading * 180) / Math.PI % 360 + 360) % 360;
}

function announce(message) {
  status.textContent = message;
}
function flash(message) {
  hud.flash.textContent = message;
  hud.flash.hidden = false;
  flashTimer = 2.5;
}

/** The on-screen buttons are for touch play only; on a desktop they would cover the HUD. */
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
function showPanel(name) {
  for (const id of ['panel-title', 'panel-help', 'panel-paused', 'panel-over']) {
    $(id).hidden = id !== name;
  }
  $('hud').hidden = name === 'panel-title' || name === 'panel-help';
  $('btn-pause').hidden = name === 'panel-title' || name === 'panel-help';
  $('touch-bar').hidden = !isTouch || (name !== null && screen !== SCREEN_PLAY);
}

function buildScenarioButtons() {
  const groups = { mission: $('scenario-missions'), landing: $('scenario-landings'), test: $('scenario-tests') };
  for (const s of SCENARIOS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scenario';
    button.textContent = `${s.name} · ${s.weather}`;
    button.title = s.brief;
    button.addEventListener('click', () => startFlight(s));
    groups[s.kind].appendChild(button);
  }
}

function renderBoard() {
  const list = $('over-board');
  list.innerHTML = '';
  const title = $('title-best');
  title.innerHTML = '';
  const rows = board.slice(0, LEADERBOARD_MAX);
  if (rows.length === 0) {
    title.textContent = 'No flights yet this visit — yours will be the first.';
    return;
  }
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${row.scenario} — ${row.score.toLocaleString()} pts · ${row.result}`;
    list.appendChild(li);
  });
  title.textContent = `Best this visit: ${rows[0].score.toLocaleString()} pts (${rows[0].scenario})`;
}

function recordFlight(result) {
  board.push({ scenario: scenario.name, score: Math.round(world.state.score), result, date: new Date().toISOString() });
  board.sort((a, b) => b.score - a.score);
  if (board.length > LEADERBOARD_MAX) board.length = LEADERBOARD_MAX;
  if (world.state.score > best) best = Math.round(world.state.score);
  renderBoard();
}

function startFlight(s) {
  scenario = s;
  world = createWorld(scenario, createRandom(seed + Math.floor(Math.random() * 100000)));
  screen = SCREEN_PLAY;
  view = VIEW_COCKPIT;
  showPanel(null);
  announce(`Flying ${s.name}. ${s.brief}`);
}

function endFlight(reason) {
  screen = SCREEN_OVER;
  const state = world.state;
  const title = $('over-title');
  const lines = $('over-lines');
  lines.innerHTML = '';
  let result = '';
  if (reason === 'landed-perfect' || reason === 'landed') {
    const l = state.landing;
    title.textContent = reason === 'landed-perfect' ? 'Landed — clean!' : 'Landed';
    result = reason === 'landed-perfect' ? 'Perfect landing' : 'Landed';
    lines.innerHTML = `<li>Score ${Math.round(state.score).toLocaleString()} pts</li>`
      + `<li>Centreline error ${fmt(l.error, 1)} m (limit ${LANDING_MAX_ERROR_M} m)</li>`
      + `<li>Descent ${fmt(feet(l.sink), 0)} ft/min · touchdown ${fmt(knots(l.speed), 0)} knots</li>`
      + `<li>Landing bonus ${l.bonus.toLocaleString()} pts</li>`
      + `<li>Rings ${state.ringIndex} of ${state.rings.length} · time ${fmt(state.time, 0)} s</li>`;
  } else if (reason === 'field') {
    title.textContent = 'Down in a field';
    result = 'Field landing';
    lines.innerHTML = `<li>Score ${Math.round(state.score).toLocaleString()} pts</li>`
      + `<li>Not the runway — the Kestrel is in one piece, the flight is over.</li>`
      + `<li>Rings ${state.ringIndex} of ${state.rings.length} · time ${fmt(state.time, 0)} s</li>`;
  } else if (reason === 'crash') {
    title.textContent = 'Flight over — crashed';
    result = 'Crashed';
    lines.innerHTML = `<li>Score ${Math.round(state.score).toLocaleString()} pts</li>`
      + `<li>The Kestrel hit the ground. Rings ${state.ringIndex} of ${state.rings.length}.</li>`
      + `<li>Time ${fmt(state.time, 0)} s · damage ${fmt(state.plane.damage, 0)}%</li>`;
  } else {
    title.textContent = 'Flight over — time expired';
    result = 'Timed out';
    lines.innerHTML = `<li>Score ${Math.round(state.score).toLocaleString()} pts</li>`
      + `<li>Four minutes are up. Land before the clock runs out next time.</li>`
      + `<li>Rings ${state.ringIndex} of ${state.rings.length}</li>`;
  }
  recordFlight(result);
  showPanel('panel-over');
  announce(`${title.textContent}. Score ${Math.round(state.score)}.`);
}

function updateHud() {
  const state = world.state;
  const p = state.plane;
  const hdg = headingDeg(p.heading);
  hud.alt.textContent = `${fmt(feet(p.y), 0)} ft`;
  hud.spd.textContent = `${fmt(knots(p.speed), 0)} kt`;
  hud.hdg.textContent = `${fmt(hdg, 0)}° ${compass(hdg)}`;
  hud.pos.textContent = `${fmt(p.x / 1000, 1)} km E · ${fmt(-p.z / 1000, 1)} km N`;
  hud.score.textContent = `${Math.round(state.score).toLocaleString()} pts`;
  const remain = Math.max(0, FLIGHT_SECONDS - state.time);
  hud.time.textContent = `${fmt(Math.floor(remain / 60), 0)}:${String(Math.floor(remain % 60)).padStart(2, '0')}`;
  hud.throttle.style.width = `${Math.round(p.throttle * 100)}%`;
  hud.fuel.style.width = `${Math.round(state.fuel)}%`;
  hud.fuelText.textContent = `Fuel ${fmt(state.fuel, 0)}%`;
  hud.engine.textContent = state.engine.state === 'ok'
    ? 'Engine OK'
    : state.engine.state === 'failing'
      ? `ENGINE FAILURE — ${Math.ceil(state.engine.countdown)}s`
      : 'Engine dead';
  hud.engine.className = state.engine.state === 'ok' ? 'ok' : 'bad';
  hud.wind.textContent = `Wind ${fmt(knots(state.windSpeed), 0)} kt · ${state.weather.name}`;
  hud.vol.textContent = `Vol ${volume}`;
  const ring = state.rings[state.ringIndex];
  if (state.landingPhase) {
    hud.objective.textContent = 'Land at Meridian Field';
    const d = Math.hypot(p.x, p.z);
    hud.distance.textContent = `Runway ${fmt(d / 1000, 2)} km`;
    hud.guide.textContent = d > 200 ? 'Runway ahead — follow the lights' : 'On final — keep the centreline';
  } else if (ring) {
    hud.objective.textContent = `Ring ${state.ringIndex + 1} of ${state.rings.length}`;
    const d = Math.hypot(p.x - ring.x, p.y - ring.y, p.z - ring.z);
    hud.distance.textContent = `Next ring ${fmt(d / 1000, 2)} km`;
    hud.guide.textContent = 'Fly through the gold ring';
  } else {
    hud.objective.textContent = 'Free flight';
    hud.distance.textContent = '';
    hud.guide.textContent = 'Enjoy the valley';
  }
  hud.guideDist.textContent = hud.distance.textContent;
  // Attitude: the horizon turns with the roll and slides with the pitch.
  hud.horizon.style.transform = `rotate(${-p.roll * 57.2958}deg) translateY(${p.pitch * 57.2958 * 0.9}px)`;
  // Engine failure warning.
  const failing = state.engine.state === 'failing';
  hud.warn.hidden = !failing;
  if (failing) hud.warnCount.textContent = `${Math.ceil(state.engine.countdown)}s — press R to restart`;
  if (flashTimer > 0) {
    flashTimer -= 1 / 60;
    if (flashTimer <= 0) hud.flash.hidden = true;
  }
}

function runShot(name) {
  // The title screen needs its scenario buttons even in shot mode, or the
  // panel shows empty headings.
  buildScenarioButtons();
  renderBoard();
  const staged = stageShot(name, world);
  screen = staged.screen;
  view = staged.view;
  best = staged.best;
  if (screen === SCREEN_TITLE) showPanel('panel-title');
  else showPanel(null);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, screen, view, world.state.time);
    updateHud();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let accumulator = 0;
  let last = performance.now();

  function handleActions(actions) {
    if (actions & ACTION_VIEW && screen === SCREEN_PLAY) {
      view = (view + 1) % 3;
      flash(view === VIEW_COCKPIT ? 'Cockpit view' : view === VIEW_CHASE ? 'Chase view' : 'Tower view');
    }
    if (actions & ACTION_RESTART && screen === SCREEN_PLAY && world.state.engine.state === 'failing') {
      announce('Restarting the engine.');
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE) startFlight(scenario);
      else if (screen === SCREEN_OVER) startFlight(scenario);
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        showPanel('panel-paused');
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        showPanel(null);
        announce('Flying.');
      }
    }
  }

  function step(actions) {
    const controls = {
      pitch: input.pitch(),
      roll: input.roll(),
      throttleUp: input.throttleUp() || touch.throttleUp,
      throttleDown: input.throttleDown() || touch.throttleDown,
      brake: input.brake() || touch.brake,
      restart: Boolean(actions & ACTION_RESTART),
    };
    const events = world.step(STEP, controls);
    if (events & EVENT_RING) flash(`Ring ${world.state.ringIndex} of ${world.state.rings.length} — +5,000`);
    if (events & EVENT_ALL_RINGS) flash('All rings — head for the runway!');
    if (events & EVENT_FAILURE) announce('Engine failure. Press R within 15 seconds.');
    if (events & EVENT_RESTART) flash('Engine restarted');
    if (events & EVENT_FUEL) flash('Out of fuel — gliding');
    if (events & EVENT_LANDED) endFlight(world.state.endReason);
    else if (events & EVENT_CRASH) endFlight('crash');
    else if (events & EVENT_TIMEOUT) endFlight('time');
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE) {
      // The title screen's backdrop: the Kestrel parked on the runway, the camera orbiting.
      titleTime += dt;
      accumulator = 0;
    } else if (screen === SCREEN_PLAY) {
      accumulator += dt;
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        step(actions);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, view, screen === SCREEN_TITLE ? titleTime : world.state.time);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) updateHud();
  }

  // Buttons: title, help, pause, over, and the touch bar.
  $('btn-help').addEventListener('click', () => { screen = SCREEN_TITLE; showPanel('panel-help'); });
  $('help-close').addEventListener('click', () => showPanel('panel-title'));
  $('paused-resume').addEventListener('click', () => { screen = SCREEN_PLAY; showPanel(null); });
  $('paused-quit').addEventListener('click', () => { screen = SCREEN_TITLE; parkPlane(); showPanel('panel-title'); });
  $('over-again').addEventListener('click', () => startFlight(scenario));
  $('over-menu').addEventListener('click', () => { screen = SCREEN_TITLE; parkPlane(); showPanel('panel-title'); });
  $('btn-pause').addEventListener('click', () => {
    if (screen === SCREEN_PLAY) { screen = SCREEN_PAUSED; showPanel('panel-paused'); }
  });
  $('btn-view').addEventListener('click', () => {
    if (screen === SCREEN_PLAY) { view = (view + 1) % 3; flash(view === VIEW_COCKPIT ? 'Cockpit view' : view === VIEW_CHASE ? 'Chase view' : 'Tower view'); }
  });
  $('btn-restart').addEventListener('click', () => {
    if (screen === SCREEN_PLAY) input.queue(ACTION_RESTART);
  });
  function holdButton(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[key] = true; });
    el.addEventListener('pointerup', () => { touch[key] = false; });
    el.addEventListener('pointercancel', () => { touch[key] = false; });
    el.addEventListener('pointerleave', () => { touch[key] = false; });
  }
  holdButton('btn-thr-up', 'throttleUp');
  holdButton('btn-thr-down', 'throttleDown');
  holdButton('btn-brake', 'brake');
  $('btn-restart').addEventListener('click', () => { /* restart is handled by the key path */ });

  const volumeInput = $('volume');
  volumeInput.addEventListener('input', () => {
    volume = Number(volumeInput.value);
    $('volume-value').textContent = `${volume}`;
  });
  $('volume-value').textContent = `${volume}`;

  // Leaving the tab pauses a running game rather than letting the plane fly unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      showPanel('panel-paused');
      announce('Paused.');
    }
  });

  buildScenarioButtons();
  renderBoard();
  parkPlane();
  showPanel('panel-title');
  announce('Kestrel Courier. Choose a flight to begin.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
