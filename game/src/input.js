// Keyboard and pointer input. Held keys give pitch, roll and throttle; one-shot presses
// (confirm, pause, view, restart) are queued as bit flags and taken once by the loop, so a
// press between two frames is never lost and never counted twice. Dragging on the canvas
// steers the same way the arrow keys do, and the on-screen buttons do the rest.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_VIEW = 4;
export const ACTION_RESTART = 8;

const PITCH_UP = new Set(['ArrowUp', 'KeyI']);
const PITCH_DOWN = new Set(['ArrowDown', 'KeyK']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyJ']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyL']);
const THROTTLE_UP = new Set(['KeyW']);
const THROTTLE_DOWN = new Set(['KeyS']);
const BRAKE = new Set(['Space']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const VIEW = new Set(['KeyV', 'KeyC']);
const RESTART = new Set(['KeyR']);

export function createInput(canvas) {
  const held = {
    pitchUp: false, pitchDown: false, rollLeft: false, rollRight: false,
    throttleUp: false, throttleDown: false, brake: false,
  };
  let actions = 0;
  let drag = null;

  function press(code) {
    if (PITCH_UP.has(code)) held.pitchUp = true;
    else if (PITCH_DOWN.has(code)) held.pitchDown = true;
    else if (ROLL_LEFT.has(code)) held.rollLeft = true;
    else if (ROLL_RIGHT.has(code)) held.rollRight = true;
    else if (THROTTLE_UP.has(code)) held.throttleUp = true;
    else if (THROTTLE_DOWN.has(code)) held.throttleDown = true;
    else if (BRAKE.has(code)) held.brake = true;
    else if (CONFIRM.has(code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(code)) actions |= ACTION_PAUSE;
    else if (VIEW.has(code)) actions |= ACTION_VIEW;
    else if (RESTART.has(code)) actions |= ACTION_RESTART;
    else return false;
    return true;
  }

  function release(code) {
    if (PITCH_UP.has(code)) held.pitchUp = false;
    else if (PITCH_DOWN.has(code)) held.pitchDown = false;
    else if (ROLL_LEFT.has(code)) held.rollLeft = false;
    else if (ROLL_RIGHT.has(code)) held.rollRight = false;
    else if (THROTTLE_UP.has(code)) held.throttleUp = false;
    else if (THROTTLE_DOWN.has(code)) held.throttleDown = false;
    else if (BRAKE.has(code)) held.brake = false;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (press(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => release(event.code));
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    for (const key of Object.keys(held)) held[key] = false;
    drag = null;
  });

  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  return {
    /** Pitch input -1 (down) .. 1 (up), roll input -1 (left) .. 1 (right). */
    pitch() {
      let value = (held.pitchUp ? 1 : 0) - (held.pitchDown ? 1 : 0);
      if (drag) value += Math.max(-1, Math.min(1, -drag.dy / 120));
      return Math.max(-1, Math.min(1, value));
    },
    roll() {
      let value = (held.rollRight ? 1 : 0) - (held.rollLeft ? 1 : 0);
      if (drag) value += Math.max(-1, Math.min(1, drag.dx / 120));
      return Math.max(-1, Math.min(1, value));
    },
    throttleUp() { return held.throttleUp; },
    throttleDown() { return held.throttleDown; },
    brake() { return held.brake; },
    /** Queue a one-shot action from a button (the same flags as the keys). */
    queue(action) { actions |= action; },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
