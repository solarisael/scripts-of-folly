import { owner_intersects_viewport } from "./visibility.js";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const minimum_frame_interval = (maximum_frame_rate) =>
  Number.isFinite(maximum_frame_rate) && maximum_frame_rate > 0
    ? 1000 / maximum_frame_rate
    : 0;

const motion_is_reduced = () =>
  globalThis.window?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;

export const create_frame_state = (owner) => ({
  disposed: false,
  document_visible:
    !globalThis.document || document.visibilityState !== "hidden",
  elapsed_ms: 0,
  first_frame_rendered: false,
  frame: null,
  intersection_observer: null,
  last_frame_time: null,
  motion_reduced: motion_is_reduced(),
  needs_render: true,
  owner_visible: owner_intersects_viewport(owner),
  rendering: false,
  resize_observer: null,
  size: { width: 0, height: 0, dpr: 0 },
});

export const advance_frame_clock = (state, frame_time) => {
  if (state.motion_reduced) {
    state.elapsed_ms = 0;
  } else if (state.last_frame_time !== null) {
    state.elapsed_ms += Math.max(0, frame_time - state.last_frame_time);
  }
  state.last_frame_time = state.motion_reduced ? null : frame_time;
};

const capped_pixel_ratio = (dpr_cap) =>
  Math.min(Math.max(globalThis.window?.devicePixelRatio || 1, 1), dpr_cap);

export const sync_effect_size = (canvas, renderer, effect, state, dpr_cap) => {
  const rect = canvas.getBoundingClientRect();
  const dpr = capped_pixel_ratio(dpr_cap);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const changed =
    width !== state.size.width ||
    height !== state.size.height ||
    dpr !== state.size.dpr;

  if (changed) {
    state.size = { width, height, dpr };
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    effect?.resize?.({
      width: Math.max(1, Math.round(width * dpr)),
      height: Math.max(1, Math.round(height * dpr)),
      dpr,
    });
  }

  return state.size;
};
