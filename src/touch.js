// Touch controls for phones and tablets, as in mobile games: a joystick on the left to walk (all
// the way out to run), a joystick on the right to turn the view, and dragging anywhere else on
// the screen turns it too. Round buttons above the right stick open the nearest door, jump and
// switch between first and third person, and a fourth switches to the view from above (where the
// left stick moves over the house and two fingers pinch to zoom).
//
// Shown on touch screens (or with ?touch for testing on a desktop). Uses pointer events, so each
// finger is tracked on its own and a mouse works as well.
//
//   const touch = createTouchControls({ cam, onDoor, onJump, onView });
//   input.stick = touch.stick;          // { x, y } in -1..1, y forward
//   touch.update(dt);                   // each frame: turns cam by the right stick

import { t } from './i18n.js';

const RADIUS = 56;          // how far the knob travels, px
const RUN_AT = 0.92;        // stick pushed this far out: run
const LOOK_RATE = 2.2;      // right stick fully out: radians a second
const DRAG_LOOK = 0.0045;   // dragging the screen: radians a pixel

const CSS = `
  .tc-stick { position: fixed; bottom: calc(28px + env(safe-area-inset-bottom)); width: 140px; height: 140px; border-radius: 50%;
    background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.35); touch-action: none; z-index: 5;
    -webkit-user-select: none; user-select: none; }
  .tc-stick.left { left: calc(28px + env(safe-area-inset-left)); }
  .tc-stick.right { right: calc(28px + env(safe-area-inset-right)); }
  .tc-knob { position: absolute; left: 50%; top: 50%; width: 62px; height: 62px; margin: -31px 0 0 -31px; border-radius: 50%;
    background: rgba(255,255,255,0.55); box-shadow: 0 2px 8px rgba(0,0,0,0.35); pointer-events: none; }
  .tc-buttons { position: fixed; right: calc(36px + env(safe-area-inset-right)); bottom: calc(190px + env(safe-area-inset-bottom));
    display: flex; flex-direction: column; gap: 12px; z-index: 5; }
  .tc-btn { width: 58px; height: 58px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.4); background: rgba(0,0,0,0.35);
    color: #fff; font: 600 13px system-ui, sans-serif; touch-action: none; -webkit-user-select: none; user-select: none; }
  .tc-btn:active { background: rgba(255,255,255,0.3); }
  /* a phone held sideways is too short for the column: the buttons go in a row beside the right stick */
  @media (max-height: 520px) {
    .tc-buttons { flex-direction: row; bottom: calc(68px + env(safe-area-inset-bottom)); right: calc(190px + env(safe-area-inset-right)); }
  }
`;

// a phone or tablet: a finger is the main pointer (a laptop with a touch screen keeps its mouse
// and keyboard controls)
export const isTouchDevice = () => new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);

export function createTouchControls({ cam, onDoor, onJump, onView, onTop, onDims, onStorey, onPinch, clampPitch }) {
  const stick = { x: 0, y: 0 };
  const look = { x: 0, y: 0 };
  const state = { stick, run: false, update };

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // a joystick: the knob follows the finger inside the ring and reports -1..1
  function joystick(side, out) {
    const base = document.createElement('div');
    base.className = `tc-stick ${side}`;
    const knob = document.createElement('div');
    knob.className = 'tc-knob';
    base.appendChild(knob);
    document.body.appendChild(base);
    let id = null, cx = 0, cy = 0;
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) { dx *= RADIUS / d; dy *= RADIUS / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      out.x = dx / RADIUS;
      out.y = -dy / RADIUS;
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      out.x = out.y = 0;
      knob.style.transform = '';
    };
    base.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      try { base.setPointerCapture(id); } catch { /* a pointer the browser no longer tracks */ }
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      move(e);
      e.preventDefault();
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
  joystick('left', stick);
  joystick('right', look);

  // round buttons: a press fires once
  const buttons = document.createElement('div');
  buttons.className = 'tc-buttons';
  for (const [label, action, key] of [[t('touchDoor'), onDoor], [t('touchJump'), onJump], [t('touchView'), onView], [t('touchTop'), onTop], [t('touchDims'), onDims], [t('touchStorey'), onStorey, 'storey']]) {
    if (!action) continue;
    const b = document.createElement('button');
    b.className = 'tc-btn';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); action(); });
    // the storey button waits until the house turns out to have more than one (state.storeyButton)
    if (key === 'storey') { b.hidden = true; state.storeyButton = b; }
    buttons.appendChild(b);
  }
  document.body.appendChild(buttons);

  // dragging on the scene itself turns the view with one finger; two fingers pinch to zoom
  const fingers = new Map();
  let spread = 0;
  const canvas = document.querySelector('canvas');
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || fingers.size >= 2) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    spread = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    if (fingers.size === 1) {
      cam.yaw -= (e.clientX - f.x) * DRAG_LOOK;
      cam.pitch = clampPitch(cam.pitch + (e.clientY - f.y) * DRAG_LOOK * 0.85);
    }
    f.x = e.clientX;
    f.y = e.clientY;
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      // fingers closing: farther away
      if (spread > 0 && d > 0) onPinch?.(spread / d);
      spread = d;
    }
  });
  const endDrag = (e) => { fingers.delete(e.pointerId); spread = 0; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // the keyboard help would sit under the right stick: a short touch help at the top instead,
  // gone after a few seconds
  const help = document.getElementById('help');
  if (help) {
    help.textContent = t('touchHelp');
    Object.assign(help.style, { top: 'calc(56px + env(safe-area-inset-top))', bottom: 'auto', left: '50%', right: 'auto', transform: 'translateX(-50%)', textAlign: 'center', maxWidth: '86vw' });
    setTimeout(() => { help.hidden = true; }, 12000);
  }

  // a phone has no hover or keys: the browser's own long-press menu and zoom stay out of the way
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  function update(dt) {
    state.run = Math.hypot(stick.x, stick.y) >= RUN_AT;
    // a small dead zone, then a curve: fine turns near the middle, fast at the rim
    const curve = (v) => (Math.abs(v) < 0.08 ? 0 : Math.sign(v) * v * v);
    cam.yaw -= curve(look.x) * LOOK_RATE * dt;
    cam.pitch = clampPitch(cam.pitch - curve(look.y) * LOOK_RATE * 0.7 * dt);
  }

  return state;
}
