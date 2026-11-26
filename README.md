# Kestrel Courier

[![Kestrel Courier](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/nninhao174-cloud/flight-game/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/nninhao174-cloud/flight-game/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A complete, original flight game that plays offline in a desktop browser from its own
files. Fly the Kestrel courier over Caelum Valley, through the gold rings, and bring her
home to Meridian Field — before the engine quits on you.

## How to play

Open `game/index.html` in desktop Chrome (or run `node serve.ts` and open
http://localhost:8080). No network, no build step, no libraries.

- **↑ / ↓** pitch, **← / →** bank and turn, **W / S** throttle, **Space** brake,
  **V** change view, **R** restart the engine, **P** pause. Drag on the screen to
  steer; the buttons on the right work by touch.
- A sortie lasts 4 minutes and pays 20,000 points a minute while you hold 120 knots
  near 1,500 ft. Each gold ring is worth 5,000. At 3.5 minutes the runway lights come
  on 1.2 km out: land on the centreline, within 10 m, sinking at least 300 ft/min.
- The engine fails every 80–120 seconds. Press **R** within 15 seconds or it stays
  dead and you glide. Watch the fuel too.
- Three views: cockpit, chase, and the tower. Fifteen flights to choose from:
  5 missions, 5 landing challenges, 5 test flights, in clear, windy, storm and
  dusk weather. The leaderboard keeps your best flights of this visit only.

## How it is built

- `game/src/world.js` — the flight model: pitch, roll, throttle, wind, turbulence,
  fuel, damage, engine failures, rings and the landing, in fixed 1/60 s steps.
- `game/src/render.js` — one WebGL program, every frame drawn with triangles:
  the terrain heightfield, the runway, Aurelia's buildings, the Kestrel, the
  clouds and the rings. The HUD is DOM text, never a 2D canvas.
- `game/src/shots.js` — an autopilot that stages the screenshot scenes.
- `game/src/main.js` — the loop, the screens and the leaderboard.
- `main.ts` — the hand-in: copies `game/` and `screenshots/` and writes the
  dossier with the vendored make.fun library.

## Screenshots

`1-flight.png` is the cover: the cockpit view in flight, a gold ring ahead and the
instruments lit. Then the title screen, a chase view on final approach, and an
engine failure with the warning counting down.
