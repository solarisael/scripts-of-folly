// Frame budget for the text effects. The effects together may use a share of
// each frame on the GPU. Each visible effect gets a part of that time in
// proportion to its share. An effect that costs more than its part steps
// down: first a lower render scale, then a lower frame rate, then a still.
// It steps up again when the next level up fits well inside its part.
//
// The cost of an effect is its measured GPU time: on WebGPU with the
// "timestamp-query" feature, each effect draws in its own timed pass. An
// effect without a measurement stays at full quality. Wall time cannot stand
// in for it: a batch waits about the same for the GPU whatever it draws.

// The part of each frame that all text effects together may use.
export const TEXT_FRAME_SHARE = 0.5;

// The share of each effect, relative to 1. Expensive effects (many noise
// octaves or blur taps) get a larger share. A stacked effect adds the shares
// of its layers.
const EFFECT_SHARES = Object.freeze({
  aura: 2,
  veil: 2,
  drown: 2,
  cadence_oracular: 1.5,
  whisper: 1.5,
  sigil_pulse: 1.2,
});
const DEFAULT_SHARE = 1;

// The levels, cheapest last: render scale, and the fraction of frames drawn.
// A rate of 0 is a still: the effect draws once and keeps that picture.
export const LEVELS = Object.freeze([
  { scale: 1, rate: 1 },
  { scale: 0.75, rate: 1 },
  { scale: 0.5, rate: 1 },
  { scale: 0.5, rate: 1 / 2 },
  { scale: 0.5, rate: 1 / 4 },
  { scale: 0.5, rate: 0 },
]);

// An effect steps down after it is over its part for this long, and steps up
// after the next level up fits for this long. The gap stops it flapping.
const STEP_DOWN_MS = 500;
const STEP_UP_MS = 3000;
const STEP_UP_HEADROOM = 0.7;
// How fast the cost estimate follows new measurements (0 to 1).
const SMOOTHING = 0.2;

export const effect_share = (names = []) =>
  names.length
    ? names.reduce(
        (sum, name) => sum + (EFFECT_SHARES[name] ?? DEFAULT_SHARE),
        0,
      )
    : DEFAULT_SHARE;

// The average cost per frame of an effect at `level`, from its cost per
// device pixel of one draw at full scale (`unit_ms`).
const average_ms = (state, level) => {
  const { scale, rate } = LEVELS[level];
  // A still draws once, so it costs nothing per frame.
  return state.unit_ms * state.pixels * scale * scale * rate;
};

export function create_frame_budget({ now = () => performance.now() } = {}) {
  const states = new WeakMap();

  const state_of = (item) => {
    let state = states.get(item);
    if (!state) {
      state = {
        level: 0,
        unit_ms: 0,
        pixels: 1,
        share: effect_share(item.names),
        over_since: null,
        under_since: null,
        next_draw: 0,
        drawn: false,
      };
      states.set(item, state);
    }
    return state;
  };

  return {
    level_of: (item) => LEVELS[state_of(item).level],

    // True when the effect should draw on this frame. At full rate the
    // runtime's own frame pacing decides, so the budget never gates it.
    due(item, frame_time) {
      const state = state_of(item);
      const { rate } = LEVELS[state.level];
      if (!state.drawn || rate === 1) return true;
      if (rate === 0) return false;
      return frame_time >= state.next_draw;
    },

    // Records that `item` drew on this frame at `scale`, with `pixels`
    // device pixels at full scale.
    drawn(item, frame_time, frame_ms, pixels, scale) {
      const state = state_of(item);
      state.pixels = pixels;
      state.drawn_scale = scale;
      state.drawn = true;
      const { rate } = LEVELS[state.level];
      // Half a frame of slack, so the draw lands on the frame it is due on,
      // not on the one after.
      state.next_draw =
        rate > 0 ? frame_time + frame_ms / rate - frame_ms / 2 : Infinity;
    },

    // Records the GPU time of the last draw of `item`, in milliseconds.
    gpu_time(item, ms) {
      const state = states.get(item);
      if (!state?.drawn_scale || !Number.isFinite(ms) || ms < 0) return;
      const unit =
        ms / Math.max(1, state.pixels * state.drawn_scale * state.drawn_scale);
      state.unit_ms = state.unit_ms
        ? state.unit_ms + (unit - state.unit_ms) * SMOOTHING
        : unit;
    },

    // Moves each visible effect between levels. `frame_ms` is the frame
    // interval of the page.
    settle(visible_items, frame_ms) {
      const page_ms = frame_ms * TEXT_FRAME_SHARE;
      let total_share = 0;
      for (const item of visible_items) total_share += state_of(item).share;
      if (total_share <= 0) return;
      const time = now();

      for (const item of visible_items) {
        const state = state_of(item);
        if (!state.unit_ms) continue;
        const budget_ms = (page_ms * state.share) / total_share;

        if (
          state.level < LEVELS.length - 1 &&
          average_ms(state, state.level) > budget_ms
        ) {
          state.under_since = null;
          state.over_since ??= time;
          if (time - state.over_since >= STEP_DOWN_MS) {
            state.level += 1;
            state.over_since = null;
            // The new level draws at once, so its cost is measured.
            state.drawn = false;
          }
          continue;
        }
        state.over_since = null;

        if (
          state.level > 0 &&
          average_ms(state, state.level - 1) < budget_ms * STEP_UP_HEADROOM
        ) {
          state.under_since ??= time;
          if (time - state.under_since >= STEP_UP_MS) {
            state.level -= 1;
            state.under_since = null;
            state.drawn = false;
          }
        } else {
          state.under_since = null;
        }
      }
    },
  };
}
