// The screenshot scenes behind ?shot=title|flight|landing|engine. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (bank toward the target, climb or sink toward its height, hold cruise speed),
// so the frame is what a real flight looks like and the same seed always gives the same
// frame. The engine scene stages a failure and holds off the restart, so the warning and
// its countdown are on screen when the picture is taken.
import { FAILURE_ANSWER_SECONDS, SCENARIOS, STEP } from './config.js';
import { EVENT_CRASH, EVENT_LANDED } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, VIEW_CHASE, VIEW_COCKPIT } from './render.js';

const FLIGHT_SECONDS = 18;
const LANDING_SECONDS = 90;
const ENGINE_SECONDS = 88;

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Steer toward a point (x, y, z) at a target speed; restart the engine unless told not to. */
function autopilot(state, target, speed, restart) {
  const p = state.plane;
  const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
  const wantHeading = Math.atan2(dx, -dz);
  const headingError = angleDiff(wantHeading, p.heading);
  const roll = clamp(headingError * 1.6, -1, 1);
  const pitch = clamp(dy / 90, -1, 1) * 0.7;
  return {
    pitch,
    roll,
    throttleUp: p.speed < speed - 2,
    throttleDown: p.speed > speed + 2,
    brake: false,
    restart: restart && state.engine.state === 'failing',
  };
}

/** The landing autopilot: hold the 3-degree glidepath by sink rate (a steady 2.6 m/s on
 *  the path, faster when high, slower when low), and hold the centreline by ground
 *  track — the heading is the crab angle that cancels the crosswind, plus a correction
 *  that pulls the plane back when the wind has already pushed it off. */
function landingPilot(state) {
  const p = state.plane;
  // Aim the glidepath at a point 50 m past the threshold, not at the threshold itself:
  // the plane meets the ground a fraction early, and exactly-on-the-numbers is a
  // field landing instead of a runway one.
  const glideAlt = 2 + Math.max(0, -350 - p.x) * 0.052;
  const err = p.y - glideAlt;
  // Sink at the glidepath's own rate (slope times ground speed), faster when high,
  // slower when low — so the plane meets the runway at the numbers, not short of it.
  const desiredSink = clamp(0.052 * state.groundSpeed + err * 0.3, 0.5, 10);
  const currentSink = -state.verticalSpeed;
  // Feedforward: the pitch that holds exactly the wanted sink at this speed, plus a
  // feedback term that corrects any error — so the plane stays on the glidepath
  // instead of drifting below it and touching down short of the runway.
  const ff = -Math.asin(clamp(desiredSink / Math.max(p.speed, 20), -0.5, 0.5)) / 0.45;
  // Feedforward only: the pitch that holds exactly the wanted sink. A feedback term
  // on the sink error makes the pitch flip every step and the plane lands short.
  const pitch = clamp(ff, -1, 1);
  const desiredLateral = clamp(-p.z * 0.06, -8, 8);
  const cosH = clamp((state.wind.z - desiredLateral) / Math.max(p.speed, 20), -1, 1);
  const wantHeading = Math.acos(cosH);
  const roll = clamp(angleDiff(wantHeading, p.heading) * 2.2, -1, 1);
  return {
    pitch,
    roll,
    throttleUp: p.speed < 48,
    throttleDown: p.speed > 54,
    brake: false,
    restart: state.engine.state === 'failing',
  };
}

/**
 * Set `world` to the named scene and return the screen and camera to draw over it.
 * Any other name stages the title screen.
 */
export function stageShot(name, world) {
  const state = world.state;
  if (name === 'flight') {
    world.reset();
    for (let i = 0; i < FLIGHT_SECONDS / STEP; i += 1) {
      const ring = state.rings[state.ringIndex] || { x: 0, y: 457, z: 0 };
      const target = state.landingPhase ? { x: 0, y: 300, z: 0 } : ring;
      const events = world.step(STEP, autopilot(state, target, 61.7, true));
      if (events & (EVENT_CRASH | EVENT_LANDED)) break;
    }
    // Chase view for the cover: the Kestrel in frame with the ring ahead and the
    // HUD lit, instead of a cockpit frame that can fill with a building mid-turn.
    return { screen: SCREEN_PLAY, view: VIEW_CHASE, best: state.score };
  }
  if (name === 'landing') {
    world.reset();
    for (let i = 0; i < LANDING_SECONDS / STEP; i += 1) {
      const events = world.step(STEP, landingPilot(state));
      if (events & (EVENT_CRASH | EVENT_LANDED)) break;
      if (state.plane.x > -500 && state.plane.y < 120) break;
    }
    return { screen: SCREEN_PLAY, view: VIEW_CHASE, best: state.score };
  }
  if (name === 'engine') {
    world.reset();
    let failedAt = -1;
    for (let i = 0; i < ENGINE_SECONDS / STEP; i += 1) {
      const events = world.step(STEP, autopilot(state, state.rings[state.ringIndex] || { x: 0, y: 457, z: 0 }, 61.7, false));
      if (state.engine.state === 'failing' && failedAt < 0) failedAt = state.time;
      if (failedAt >= 0 && state.time - failedAt > 5) break;
      if (events & (EVENT_CRASH | EVENT_LANDED)) break;
    }
    // If no failure fired in the window, force one so the scene always shows it.
    if (state.engine.state === 'ok') {
      state.engine.state = 'failing';
      state.engine.countdown = FAILURE_ANSWER_SECONDS - 5;
    }
    return { screen: SCREEN_PLAY, view: VIEW_COCKPIT, best: state.score };
  }
  world.reset();
  // The title shot: the Kestrel parked on the runway, the camera orbiting the field.
  const p = state.plane;
  p.x = -350; p.y = 2; p.z = 0;
  p.heading = Math.PI / 2; p.pitch = 0; p.roll = 0;
  p.speed = 0; p.throttle = 0;
  return { screen: SCREEN_TITLE, view: VIEW_CHASE, best: 0 };
}

export { SCENARIOS };
