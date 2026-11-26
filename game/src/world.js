// The flight model and the world, with no drawing and no browser in it: the plane, the
// terrain, the wind, the rings, the engine failures, the fuel, the landing and the score.
// step() advances one fixed step and returns what happened as bit flags, so the caller can
// react without the world knowing about screens or sound. Nothing here allocates after
// createWorld returns. Every random draw comes from the seeded stream, so the same seed and
// the same inputs always give the same flight.
import {
  ALL_RINGS_BONUS, CRUISE_SPEED, FAILURE_ANSWER_SECONDS, FAILURE_MAX_SECONDS,
  FAILURE_MIN_SECONDS, FLIGHT_SECONDS, FUEL_DRAIN_PER_SECOND, LANDING_BASE,
  LANDING_BONUS_MAX, LANDING_MAX_ERROR_M, LANDING_MAX_SINK_MS, LANDING_MIN_SINK_MS,
  LANDING_PHASE_SECONDS, MAX_ALTITUDE, MAX_SPEED, RING_BONUS, RUNWAY, SCORE_PER_SECOND,
  STALL_SPEED, STEP, TARGET_ALTITUDE, TERRAIN_SEED, WEATHER, WORLD_SIZE,
} from './config.js';
import { hash2, smooth } from './random.js';

export const EVENT_RING = 1;
export const EVENT_ALL_RINGS = 2;
export const EVENT_FAILURE = 4;
export const EVENT_RESTART = 8;
export const EVENT_LANDED = 16;
export const EVENT_CRASH = 32;
export const EVENT_TIMEOUT = 64;
export const EVENT_FUEL = 128;

const RING_RADIUS = 50;
const HALF = WORLD_SIZE / 2;

/**
 * The ground height at (x, z), in metres. Three octaves of value noise, a flat airfield around
 * the runway, a lake depression to the north-west, and mountains rising at the edges.
 */
export function terrainHeight(x, z) {
  const nx = x / 900;
  const nz = z / 900;
  let h = 0;
  h += 55 * valueNoise(nx, nz);
  h += 28 * valueNoise(nx * 2.3 + 7, nz * 2.3 + 3);
  h += 12 * valueNoise(nx * 5.1 + 13, nz * 5.1 + 9);
  h -= 18;
  // The airfield is flat: blend to 0 within 500 m of the runway.
  const dField = Math.max(Math.abs(x) - 500, Math.abs(z) - 260);
  const flat = smooth(0, 1, Math.max(0, -dField) / 220);
  h *= 1 - flat;
  // The approach funnel: flat along the runway's extended centreline, so the final
  // approach from the west is clear of hills however the wind blows.
  const zf = smooth(0, 1, (200 - Math.abs(z)) / 80);
  const xf = smooth(0, 1, Math.min(x + 2800, 600 - x) / 200);
  h *= 1 - zf * xf;
  // Mirror Lake, north-west: a dip that sits below the water line.
  const dLake = Math.hypot((x + 1500) / 700, (z + 1200) / 500);
  if (dLake < 1) h = smooth(-14, h, dLake);
  // Mountains at the edges of the world.
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  if (edge > 0.72) h += (edge - 0.72) * 900;
  return h;
}

function valueNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const a = hash2(xi, zi, TERRAIN_SEED);
  const b = hash2(xi + 1, zi, TERRAIN_SEED);
  const c = hash2(xi, zi + 1, TERRAIN_SEED);
  const d = hash2(xi + 1, zi + 1, TERRAIN_SEED);
  const u = smooth(0, 1, xf);
  const v = smooth(0, 1, zf);
  return smooth(smooth(a, b, u), smooth(c, d, u), v) * 2 - 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createWorld(scenario, random) {
  const weather = WEATHER[scenario.weather];
  const windDir = (weather.windDir * Math.PI) / 180;
  const wind = { x: Math.sin(windDir) * weather.windSpeed, z: -Math.cos(windDir) * weather.windSpeed };

  // Aurelia's buildings: a seeded grid south-east of the field, kept clear of the runway.
  const buildings = [];
  for (let i = 0; i < 30; i += 1) {
    const bx = 500 + random() * 700;
    const bz = 250 + random() * 650;
    if (Math.abs(bz) < 60) continue;
    buildings.push({
      x: bx, z: bz,
      w: 24 + random() * 30, d: 24 + random() * 30,
      h: 14 + random() * 46,
      glass: random() < 0.45,
    });
  }
  // Cloud puffs, drifting with the wind.
  const clouds = [];
  for (let i = 0; i < 12; i += 1) {
    clouds.push({
      x: -2800 + random() * 5600,
      y: 620 + random() * 260,
      z: -2800 + random() * 5600,
      s: 90 + random() * 130,
    });
  }

  const plane = {
    x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0,
    speed: 0, throttle: 0.55, fuel: 100, damage: 0,
  };
  const engine = { state: 'ok', countdown: 0, nextFailureAt: 0 };
  const state = {
    plane, engine, weather, wind, buildings, clouds,
    scenario, rings: scenario.rings.map((r) => ({ ...r, done: false })),
    ringIndex: 0, time: 0, score: 0, fuel: 100,
    landingPhase: scenario.rings.length === 0,
    landed: false, crashed: false, ended: false, endReason: '',
    landing: null, groundSpeed: 0, verticalSpeed: 0, windSpeed: weather.windSpeed,
  };

  function reset() {
    const s = scenario.start;
    plane.x = s.x;
    plane.y = s.y;
    plane.z = s.z;
    plane.heading = (s.heading * Math.PI) / 180;
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = s.speed;
    plane.throttle = clamp(s.speed / CRUISE_SPEED, 0.3, 0.8);
    plane.fuel = 100;
    plane.damage = 0;
    engine.state = 'ok';
    engine.countdown = 0;
    engine.nextFailureAt = FAILURE_MIN_SECONDS + random() * (FAILURE_MAX_SECONDS - FAILURE_MIN_SECONDS);
    for (const ring of state.rings) ring.done = false;
    state.ringIndex = 0;
    state.time = 0;
    state.score = 0;
    state.fuel = 100;
    state.landingPhase = scenario.rings.length === 0;
    state.landed = false;
    state.crashed = false;
    state.ended = false;
    state.endReason = '';
    state.landing = null;
  }

  function forward() {
    const cp = Math.cos(plane.pitch);
    return {
      x: Math.sin(plane.heading) * cp,
      y: Math.sin(plane.pitch),
      z: -Math.cos(plane.heading) * cp,
    };
  }

  /**
   * One fixed step. controls: { pitch -1..1, roll -1..1, throttleUp, throttleDown, brake,
   * restart }. Returns EVENT_* flags.
   */
  function step(dt, controls) {
    let events = 0;
    if (state.ended) return events;
    state.time += dt;

    // Engine failure: the clock runs, the warning sounds, the pilot has 15 s to answer.
    if (engine.state === 'ok' && state.time >= engine.nextFailureAt) {
      engine.state = 'failing';
      engine.countdown = FAILURE_ANSWER_SECONDS;
      events |= EVENT_FAILURE;
    } else if (engine.state === 'failing') {
      engine.countdown -= dt;
      if (controls.restart) {
        engine.state = 'ok';
        engine.nextFailureAt = state.time + FAILURE_MIN_SECONDS + random() * (FAILURE_MAX_SECONDS - FAILURE_MIN_SECONDS);
        events |= EVENT_RESTART;
      } else if (engine.countdown <= 0) {
        engine.state = 'dead';
      }
    }
    if (engine.state === 'ok' && plane.fuel <= 0) {
      engine.state = 'dead';
      events |= EVENT_FUEL;
    }

    // Throttle and brake.
    if (controls.throttleUp) plane.throttle = clamp(plane.throttle + 0.5 * dt, 0, 1);
    if (controls.throttleDown) plane.throttle = clamp(plane.throttle - 0.5 * dt, 0, 1);
    if (controls.brake) plane.throttle = clamp(plane.throttle - 1.2 * dt, 0, 1);
    if (engine.state === 'ok') plane.fuel = Math.max(0, plane.fuel - plane.throttle * FUEL_DRAIN_PER_SECOND * dt);
    state.fuel = plane.fuel;

    // Speed: thrust against drag, plus the climb and the dive.
    const thrust = engine.state === 'ok' ? plane.throttle * 14 : 0;
    const drag = 0.0035 * plane.speed * plane.speed;
    let accel = thrust - drag - 9.8 * Math.sin(plane.pitch) * 0.5;
    if (controls.brake) accel -= 6;
    plane.speed = clamp(plane.speed + accel * dt, 0, MAX_SPEED * 1.1);

    // Pitch and roll answer the controls; a slow plane answers sluggishly and sinks.
    const authority = plane.speed < STALL_SPEED ? 0.45 : 1;
    const targetPitch = controls.pitch * 0.45 * authority;
    plane.pitch += clamp(targetPitch - plane.pitch, -1.6 * dt, 1.6 * dt);
    if (plane.speed < STALL_SPEED) plane.pitch += (-0.18 - plane.pitch) * 0.8 * dt;
    const targetRoll = controls.roll * 0.9 * authority;
    plane.roll += clamp(targetRoll - plane.roll, -2.2 * dt, 2.2 * dt);
    if (Math.abs(controls.roll) < 0.05) plane.roll += (0 - plane.roll) * 0.9 * dt;
    const turnRate = (9.8 * Math.tan(plane.roll)) / Math.max(plane.speed, 20);
    plane.heading += turnRate * dt;

    // Turbulence shoves the wings, harder in a storm.
    if (weather.turbulence > 0) {
      const gust = weather.turbulence * 0.5;
      plane.pitch += (random() - 0.5) * gust * dt * 2;
      plane.roll += (random() - 0.5) * gust * dt * 2.4;
    }

    // Move: airspeed along the nose, plus the wind over the ground.
    const f = forward();
    const windNow = weather.windSpeed * (1 + (weather.turbulence > 0.5 ? (random() - 0.5) * 0.4 : 0));
    state.windSpeed = windNow;
    const wx = Math.sin(windDir) * windNow;
    const wz = -Math.cos(windDir) * windNow;
    plane.x += (f.x * plane.speed + wx) * dt;
    plane.y += f.y * plane.speed * dt;
    plane.z += (f.z * plane.speed + wz) * dt;
    if (plane.y > MAX_ALTITUDE) plane.y = MAX_ALTITUDE;
    plane.x = clamp(plane.x, -HALF, HALF);
    plane.z = clamp(plane.z, -HALF, HALF);
    state.verticalSpeed = f.y * plane.speed;
    state.groundSpeed = Math.hypot(f.x * plane.speed + wx, f.z * plane.speed + wz);

    // Score ticks while airborne and on course: near 120 knots and 1,500 ft pays full rate.
    const ground = terrainHeight(plane.x, plane.z);
    const airborne = plane.y > ground + 5;
    if (airborne) {
      const speedKnots = plane.speed * 1.94384;
      const altFt = plane.y * 3.28084;
      const onCourse = speedKnots >= 100 && speedKnots <= 140 && altFt >= 1200 && altFt <= 1800 ? 1 : 0.5;
      state.score += SCORE_PER_SECOND * onCourse * dt;
    }

    // Rings: fly through the current one to bank the bonus.
    if (state.ringIndex < state.rings.length) {
      const ring = state.rings[state.ringIndex];
      const d = Math.hypot(plane.x - ring.x, plane.y - ring.y, plane.z - ring.z);
      if (d < RING_RADIUS) {
        ring.done = true;
        state.ringIndex += 1;
        state.score += RING_BONUS;
        events |= EVENT_RING;
        if (state.ringIndex >= state.rings.length) {
          state.score += ALL_RINGS_BONUS;
          state.landingPhase = true;
          events |= EVENT_ALL_RINGS;
        }
      }
    }
    if (!state.landingPhase && state.time >= LANDING_PHASE_SECONDS) state.landingPhase = true;

    // Touchdown: the ground is unforgiving except on the runway.
    if (plane.y <= ground + 2) {
      plane.y = ground + 2;
      const onRunway = Math.abs(plane.x) <= RUNWAY.length / 2 && Math.abs(plane.z) <= RUNWAY.width / 2;
      const sink = -state.verticalSpeed;
      const lateral = Math.abs(plane.z);
      if (onRunway) {
        if (sink > LANDING_MAX_SINK_MS || plane.speed > 75) {
          state.crashed = true;
          state.ended = true;
          state.endReason = 'crash';
          events |= EVENT_CRASH;
        } else {
          const perfect = lateral <= LANDING_MAX_ERROR_M && sink >= LANDING_MIN_SINK_MS;
          const accuracy = 1 - clamp(lateral / (RUNWAY.width / 2), 0, 1);
          const bonus = LANDING_BASE + Math.round(LANDING_BONUS_MAX * accuracy * (perfect ? 1 : 0.6));
          state.score += bonus;
          state.landed = true;
          state.ended = true;
          state.endReason = perfect ? 'landed-perfect' : 'landed';
          state.landing = { error: lateral, sink, speed: plane.speed, bonus, perfect };
          events |= EVENT_LANDED;
        }
      } else if (sink > 6) {
        state.crashed = true;
        state.ended = true;
        state.endReason = 'crash';
        events |= EVENT_CRASH;
      } else {
        state.landed = true;
        state.ended = true;
        state.endReason = 'field';
        state.landing = { error: lateral, sink, speed: plane.speed, bonus: 0, perfect: false };
        events |= EVENT_LANDED;
      }
    }

    // Scraping the hillsides hurts.
    if (!state.ended && airborne && plane.y < ground + 8) {
      plane.damage = Math.min(100, plane.damage + 25 * dt);
      if (plane.damage >= 100) {
        state.crashed = true;
        state.ended = true;
        state.endReason = 'crash';
        events |= EVENT_CRASH;
      }
    }

    // Four minutes and the sortie is over, landed or not.
    if (!state.ended && state.time >= FLIGHT_SECONDS) {
      state.ended = true;
      state.endReason = 'time';
      events |= EVENT_TIMEOUT;
    }
    return events;
  }

  reset();
  return { state, reset, step, terrainHeight };
}
