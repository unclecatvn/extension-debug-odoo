// Where the panel frame goes next to the button, and its size as the user drags its edges. Pure (no DOM): tested by
// tests/unit/entrypoints/launcher/geometry.test.ts.

export interface Size { w: number; h: number }
export interface Viewport { w: number; h: number }

/** The frame's side of the button: left of it when the button is in the right half. Its free (resizable) edges are the
 * ones away from the button: left edge on the left side, and away from its anchor (top anchor: bottom edge). */
export type Side = 'left' | 'right';
/** The frame's edge aligned on the button: its top in the upper half of the window, its bottom in the lower half. */
export type Anchor = 'top' | 'bottom';

export const DEFAULT_SIZE: Size = { w: 420, h: 720 };
export const MIN_SIZE: Size = { w: 340, h: 320 };

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** The largest frame that keeps `gap` to every window edge. */
export const maxSize = (vp: Viewport, gap: number): Size => ({ w: vp.w - 2 * gap, h: vp.h - 2 * gap });

/** `s` within [MIN_SIZE, max], whole pixels. */
export const clampSize = (s: Size, max: Size): Size => ({ w: Math.round(clamp(s.w, MIN_SIZE.w, max.w)), h: Math.round(clamp(s.h, MIN_SIZE.h, max.h)) });

/** A size saved by the launcher (localStorage text), else the default. */
export function readSize(text: string | null): Size {
  try {
    const s = JSON.parse(text || 'null') as { w?: unknown; h?: unknown } | null;
    if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) return { w: s.w as number, h: s.h as number };
  } catch { /* bad value */ }
  return DEFAULT_SIZE;
}

/** The frame beside the button (`btn`: its top-left corner, `size`: its side), kept `gap` inside the window. */
export function placeFrame(btn: { x: number; y: number; size: number }, frame: Size, vp: Viewport, gap: number):
  { left: number; top: number; side: Side; anchor: Anchor } {
  const side: Side = btn.x + btn.size / 2 > vp.w / 2 ? 'left' : 'right';
  const anchor: Anchor = btn.y + btn.size / 2 < vp.h / 2 ? 'top' : 'bottom';
  const left = side === 'left' ? btn.x - frame.w - gap : btn.x + btn.size + gap;
  const top = anchor === 'top' ? btn.y : btn.y + btn.size - frame.h;
  return { left: clamp(left, gap, vp.w - frame.w - gap), top: clamp(top, gap, vp.h - frame.h - gap), side, anchor };
}

/** Which edges a grip moves: the free horizontal edge, the free vertical edge, or both (the corner between them). */
export type Grip = 'x' | 'y' | 'xy';

/** The size while dragging a grip by (dx, dy) from `start`: the free edge follows the pointer. */
export function resized(start: Size, dx: number, dy: number, grip: Grip, side: Side, anchor: Anchor, max: Size): Size {
  const w = grip === 'y' ? start.w : start.w + (side === 'left' ? -dx : dx);
  const h = grip === 'x' ? start.h : start.h + (anchor === 'top' ? dy : -dy);
  return clampSize({ w, h }, max);
}
