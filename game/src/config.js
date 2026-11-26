// Every tuning number, name and scenario in one place. The world is metres; the HUD shows
// knots and feet. The runway sits at the origin, heading east (+X). All place names are
// invented: Caelum Valley, the city of Aurelia, Meridian Field airfield, the Kestrel courier.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** A sortie lasts 4 minutes; the landing phase opens at 3.5 minutes. */
export const FLIGHT_SECONDS = 240;
export const LANDING_PHASE_SECONDS = 210;

/** Speeds in m/s. 120 knots is 61.7 m/s; 1,500 ft is 457 m. */
export const CRUISE_SPEED = 61.7;
export const MAX_SPEED = 78;
export const STALL_SPEED = 25;
export const MAX_ALTITUDE = 1000;
export const TARGET_ALTITUDE = 457;

/** Score: 20,000 points a minute while airborne and on course. */
export const SCORE_PER_SECOND = 20000 / 60;
export const RING_BONUS = 5000;
export const ALL_RINGS_BONUS = 10000;
export const LANDING_BASE = 10000;
export const LANDING_BONUS_MAX = 15000;

/** Engine failure: first one 80–120 s in, then the same again after each restart. */
export const FAILURE_MIN_SECONDS = 80;
export const FAILURE_MAX_SECONDS = 120;
/** Seconds the pilot has to answer an engine failure before the engine stays dead. */
export const FAILURE_ANSWER_SECONDS = 15;

/** A clean landing needs lateral error at most 10 m and descent of at least 300 ft/min. */
export const LANDING_MAX_ERROR_M = 10;
export const LANDING_MIN_SINK_MS = 300 * 0.3048 / 60;
export const LANDING_MAX_SINK_MS = 8;
export const RUNWAY = { x: 0, z: 0, heading: 90, length: 800, width: 30 };

/** Fuel: 100 units, drained by throttle. Empty means the engine is out. */
export const FUEL_DRAIN_PER_SECOND = 0.22;

/** The world is a 6 km square; the terrain rises into mountains at its edges. */
export const WORLD_SIZE = 6000;
export const TERRAIN_SEED = 20261126;

export const PALETTE = {
  skyClear: [0.53, 0.75, 0.93],
  skyDusk: [0.32, 0.34, 0.52],
  skyStorm: [0.42, 0.46, 0.52],
  fogClear: [0.75, 0.84, 0.92],
  fogDusk: [0.45, 0.45, 0.58],
  fogStorm: [0.55, 0.58, 0.62],
  grass: [0.32, 0.55, 0.28],
  grassDry: [0.55, 0.55, 0.32],
  rock: [0.45, 0.4, 0.36],
  snow: [0.92, 0.93, 0.95],
  sand: [0.78, 0.72, 0.55],
  water: [0.16, 0.38, 0.58],
  asphalt: [0.16, 0.16, 0.18],
  marking: [0.92, 0.92, 0.88],
  planeWhite: [0.92, 0.92, 0.9],
  planeRed: [0.78, 0.16, 0.14],
  planeDark: [0.12, 0.14, 0.18],
  ring: [1.0, 0.62, 0.1],
  ringDone: [0.35, 0.75, 0.35],
  cloud: [0.96, 0.97, 0.99],
  building: [0.62, 0.58, 0.5],
  buildingGlass: [0.35, 0.55, 0.65],
};

/** Weather presets: wind in m/s (direction degrees), turbulence 0–1, fog density, light. */
export const WEATHER = {
  clear: { name: 'Clear', windSpeed: 2, windDir: 270, turbulence: 0, fog: 0.00012, dusk: false },
  windy: { name: 'Windy', windSpeed: 8, windDir: 300, turbulence: 0.3, fog: 0.00025, dusk: false },
  storm: { name: 'Storm', windSpeed: 15, windDir: 320, turbulence: 0.8, fog: 0.0006, dusk: false },
  dusk: { name: 'Dusk', windSpeed: 4, windDir: 280, turbulence: 0.15, fog: 0.0003, dusk: true },
};

/**
 * A scenario is one selectable flight: its kind (mission, landing, test), its weather, where the
 * plane starts, and the rings it must fly. Rings are {x, y, z} in metres, y absolute.
 * The runway is always at the origin, heading east, so every route ends back at Meridian Field.
 */
export const SCENARIOS = [
  {
    id: 'mission-1', kind: 'mission', name: 'First Solo', weather: 'clear',
    brief: 'Three rings over Aurelia, then land at Meridian Field.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [
      { x: 800, y: 420, z: -600 },
      { x: 1600, y: 460, z: 300 },
      { x: 800, y: 420, z: 900 },
    ],
  },
  {
    id: 'mission-2', kind: 'mission', name: 'Valley Run', weather: 'clear',
    brief: 'Five rings down the Caelum Valley and back.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [
      { x: 700, y: 400, z: -500 },
      { x: 1400, y: 430, z: -200 },
      { x: 2100, y: 450, z: 300 },
      { x: 1600, y: 430, z: 900 },
      { x: 700, y: 400, z: 600 },
    ],
  },
  {
    id: 'mission-3', kind: 'mission', name: 'Storm Courier', weather: 'storm',
    brief: 'Four rings in a storm. Mind the gusts and the fuel.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [
      { x: 900, y: 440, z: -700 },
      { x: 1800, y: 470, z: 100 },
      { x: 1200, y: 450, z: 1000 },
      { x: 400, y: 420, z: 400 },
    ],
  },
  {
    id: 'mission-4', kind: 'mission', name: 'Night Mail', weather: 'dusk',
    brief: 'Six rings at dusk. The runway lights are your friend.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [
      { x: 600, y: 410, z: -800 },
      { x: 1300, y: 440, z: -400 },
      { x: 2000, y: 460, z: 200 },
      { x: 1500, y: 440, z: 800 },
      { x: 800, y: 420, z: 1100 },
      { x: 300, y: 410, z: 500 },
    ],
  },
  {
    id: 'mission-5', kind: 'mission', name: 'Island Hop', weather: 'windy',
    brief: 'Seven rings out to Mirror Lake and back to the field.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [
      { x: 500, y: 410, z: -600 },
      { x: -600, y: 430, z: -900 },
      { x: -1500, y: 450, z: -1200 },
      { x: -1900, y: 450, z: -400 },
      { x: -1200, y: 440, z: 400 },
      { x: -400, y: 420, z: 800 },
      { x: 500, y: 410, z: 500 },
    ],
  },
  {
    id: 'landing-1', kind: 'landing', name: 'Calm Landing', weather: 'clear',
    brief: 'No wind. Line up, sink at 300 ft/min, touch down on the centreline.',
    start: { x: -1900, y: 80, z: 0, heading: 90, speed: 50 },
    rings: [],
  },
  {
    id: 'landing-2', kind: 'landing', name: 'Crosswind', weather: 'windy',
    brief: 'A steady crosswind from the north. Crab in, straighten out late.',
    start: { x: -1900, y: 80, z: 0, heading: 90, speed: 50 },
    rings: [],
  },
  {
    id: 'landing-3', kind: 'landing', name: 'Gusty Approach', weather: 'windy',
    brief: 'Gusts that shove the wings. Small corrections, early.',
    start: { x: -1900, y: 80, z: 0, heading: 90, speed: 50 },
    rings: [],
  },
  {
    id: 'landing-4', kind: 'landing', name: 'Short Field', weather: 'clear',
    brief: 'Only 1.2 km out. Get down fast and stop on the numbers.',
    start: { x: -1600, y: 65, z: 0, heading: 90, speed: 50 },
    rings: [],
  },
  {
    id: 'landing-5', kind: 'landing', name: 'Storm Landing', weather: 'storm',
    brief: 'A storm landing. The runway is there — find it and hold it.',
    start: { x: -1900, y: 80, z: 0, heading: 90, speed: 50 },
    rings: [],
  },
  {
    id: 'test-1', kind: 'test', name: 'Free Flight', weather: 'clear',
    brief: 'No rings, no clock pressure. Just fly the valley.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [],
  },
  {
    id: 'test-2', kind: 'test', name: 'High Altitude', weather: 'clear',
    brief: 'Start at 3,000 ft and feel how thin the air gets.',
    start: { x: 0, y: 914, z: -1500, heading: 90, speed: 61.7 },
    rings: [],
  },
  {
    id: 'test-3', kind: 'test', name: 'Low Valley', weather: 'windy',
    brief: 'Start low in the valley. Keep the hills out of the windscreen.',
    start: { x: 1200, y: 180, z: 0, heading: 45, speed: 55 },
    rings: [],
  },
  {
    id: 'test-4', kind: 'test', name: 'Storm Practice', weather: 'storm',
    brief: 'A storm with nowhere to be. Learn the gusts before they matter.',
    start: { x: -300, y: 457, z: 0, heading: 90, speed: 61.7 },
    rings: [],
  },
  {
    id: 'test-5', kind: 'test', name: 'Dusk Patrol', weather: 'dusk',
    brief: 'A quiet dusk patrol over Aurelia and Mirror Lake.',
    start: { x: 0, y: 500, z: 1000, heading: 0, speed: 61.7 },
    rings: [],
  },
];

/** The in-session leaderboard: best flights of this visit only (no storage is used). */
export const LEADERBOARD_MAX = 5;
