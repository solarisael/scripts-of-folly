// Frame budget for the text effects. The effects together may use a share of
// each frame on the GPU. Each visible effect gets a part of that time in
// proportion to its share. An effect that costs more than its part steps
// down: first a lower render scale, then a lower frame rate, then a still.
// It steps up again when the next level up fits well inside its part.
//
// Timestamps measure individual passes. A fence measures the submission as
// a whole. Neither a fence nor a missed frame identifies an individual pass.

// The part of each frame that all text effects together may use.
export const TEXT_FRAME_SHARE = 0.5;

// The share of each effect, relative to 1. Expensive effects (many noise
// octaves or blur taps) get a larger share. A stacked effect adds the shares
// of its layers.
export const EFFECT_SHARES = Object.freeze({
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

export const effect_share = (names = [], shares = EFFECT_SHARES) =>
  names.length
    ? names.reduce((sum, name) => sum + (shares[name] ?? DEFAULT_SHARE), 0)
    : DEFAULT_SHARE;

// The average cost per frame of an effect at `level`, from its cost per
// device pixel of one draw at full scale (`unit_ms`).
const average_ms = (state, level) => {
  const { scale, rate } = LEVELS[level];
  // A still draws once, so it costs nothing per frame.
  return state.unit_ms * state.pixels * scale * scale * rate;
};

// Aggregate measurements can change one share, not assign costs to passes.
// At the same share, a larger tile at a higher scale or rate costs more.
function costliest(items, state_of, share_of, direction) {
  let selected = null;
  let largest = -1;
  for (const item of items) {
    const state = state_of(item);
    const next = state.level + direction;
    if (!LEVELS[next]) continue;
    const { scale, rate } = LEVELS[Math.min(next, state.level)];
    const weight = share_of(item) * state.pixels * scale * scale * rate;
    if (weight > largest) {
      selected = item;
      largest = weight;
    }
  }
  return selected;
}

function adjusted(state, direction, time) {
  if (state.direction !== direction) return { ...state, direction, since: time };
  const hold = direction > 0 ? STEP_DOWN_MS : STEP_UP_MS;
  if (!direction || time - state.since < hold) return state;
  return { ...state, level: state.level + direction, direction: 0, drawn: false };
}

function measurement_after(previous, event, capabilities = previous) {
  const rejected = previous.rejected || event === "timestamps_exceed_gap";
  const fences = capabilities.fences && event !== "fence_failed";
  const source = event === "backend_opened" && capabilities.timestamps && !rejected
    ? "timestamps" : fences ? "fences" : "frame_gaps";
  return { source, rejected, fences };
}

function aggregate_direction(source, gap, frame_ms, fence_ms, page_ms) {
  if (!(gap > 0)) return 0;
  // Allow rAF rounding and sub-frame jitter, not a missed refresh.
  if (source === "frame_gaps") return gap > frame_ms * 1.25 ? 1 : -1;
  if (source !== "fences") return 0;
  if (fence_ms > page_ms) return 1;
  return fence_ms < page_ms * STEP_UP_HEADROOM ? -1 : 0;
}

// `frame_share` and `shares` start at TEXT_FRAME_SHARE and EFFECT_SHARES.
// `tune()` changes them while the page runs, and `report()` tells the state
// of each effect of the last settle. A host can use both to show the budget
// and try other numbers.
export function create_frame_budget({
  now = () => performance.now(),
  frame_share = TEXT_FRAME_SHARE,
  shares = EFFECT_SHARES,
} = {}) {
  let states = new WeakMap();
  const tuning = { frame_share, shares: { ...shares } };
  let last = { items: [], frame_ms: 0 };
  let measurement = { source: "frame_gaps", rejected: false, fences: false };
  let fence_ms = null;
  let fresh_fence = false;
  let drew = false;
  const spans = new Map();

  function transition(event, capabilities) {
    measurement = measurement_after(measurement, event, capabilities);
    spans.clear();
    fence_ms = null;
    fresh_fence = false;
    for (const item of last.items) state_of(item).direction = 0;
  }

  const state_of = (item) => {
    let state = states.get(item);
    if (!state) {
      state = {
        level: 0,
        // A GPU time came back. A time can be 0: the browser rounds GPU
        // timestamps, and a small pass costs less than one step.
        measured: false,
        unit_ms: 0,
        pixels: 1,
        direction: 0,
        since: 0,
        next_draw: 0,
        drawn: false,
      };
      states.set(item, state);
    }
    return state;
  };
  const share_of = (item) => effect_share(item.names, tuning.shares);

  return {
    get source() { return measurement.source; },

    backend_opened(capabilities) {
      states = new WeakMap();
      last = { items: [], frame_ms: 0 };
      drew = false;
      transition("backend_opened", capabilities);
    },

    fence_failed() {
      if (measurement.source === "fences") transition("fence_failed");
    },

    fence_sample(ms) {
      if (measurement.source !== "fences") return;
      fence_ms = ms;
      fresh_fence = true;
    },

    timestamp_batch(batch) {
      if (measurement.source !== "timestamps") return;
      for (const [name, ms] of Object.entries(batch)) spans.set(name, ms);
    },
    level_of: (item) => LEVELS[state_of(item).level],

    // Sets the part of each frame for all text effects (0 to 1), and the
    // share of named effects. A share of an unnamed effect stays as it is.
    tune({ frame_share: next_frame_share, shares: next_shares } = {}) {
      if (Number.isFinite(next_frame_share) && next_frame_share > 0)
        tuning.frame_share = Math.min(1, next_frame_share);
      for (const [name, share] of Object.entries(next_shares ?? {})) {
        if (Number.isFinite(share) && share > 0) tuning.shares[name] = share;
      }
    },

    // The tuning in use, and each effect of the last settle: its names,
    // level, checked per-pass cost (if available), and share of the frame.
    report() {
      const page_ms = last.frame_ms * tuning.frame_share;
      let total_share = 0;
      for (const item of last.items) total_share += share_of(item);
      return {
        source: measurement.source,
        fence_ms,
        frame_share: tuning.frame_share,
        shares: { ...tuning.shares },
        default_share: DEFAULT_SHARE,
        levels: LEVELS,
        frame_ms: last.frame_ms,
        page_ms,
        effects: last.items.map((item) => {
          const state = state_of(item);
          const share = share_of(item);
          return {
            target: item.target,
            names: [...(item.names ?? [])],
            share,
            budget_ms: total_share ? (page_ms * share) / total_share : 0,
            level: state.level,
            cost_ms: measurement.source === "timestamps" && state.measured
              ? average_ms(state, state.level) : null,
          };
        }),
      };
    },

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
      drew = true;
      state.drawn_scale = scale;
      state.drawn = true;
      const { rate } = LEVELS[state.level];
      // Half a frame of slack, so the draw lands on the frame it is due on,
      // not on the one after.
      state.next_draw =
        rate > 0 ? frame_time + frame_ms / rate - frame_ms / 2 : Infinity;
    },

    // settle sees the gap *after* the preceding draws. All atlas batches
    // from that frame have settled, including their vgpu query readbacks.
    settle(visible_items, frame_ms, gap = null) {
      if (measurement.source === "timestamps" && gap > 0) {
        let sum = 0;
        for (const ms of spans.values()) sum += ms;
        if (sum > gap) {
          transition("timestamps_exceed_gap");
        } else {
          for (const item of last.items) {
            const ms = spans.get(item.handle?.span_name);
            if (!Number.isFinite(ms) || ms < 0) continue;
            const state = state_of(item);
            const unit = ms / Math.max(1, state.pixels * state.drawn_scale ** 2);
            state.unit_ms = state.measured
              ? state.unit_ms + (unit - state.unit_ms) * SMOOTHING : unit;
            state.measured = true;
          }
        }
      }
      spans.clear();
      const page_ms = frame_ms * tuning.frame_share;
      const time = now();
      last = { items: visible_items, frame_ms };
      const { source } = measurement;
      const waiting = source === "fences" && gap > 0 && drew && !fresh_fence;
      const direction = aggregate_direction(source, gap, frame_ms, fresh_fence ? fence_ms : 0, page_ms);
      drew = false;
      fresh_fence = false;
      if (waiting) return;
      const selected = direction && costliest(visible_items, state_of, share_of, direction);
      let total_share = 0;
      for (const item of visible_items) total_share += share_of(item);

      for (const item of visible_items) {
        const state = state_of(item);
        let demand = item === selected ? direction : 0;
        if (source === "timestamps" && gap > 0 && state.measured) {
          const part = page_ms * share_of(item) / total_share;
          const over = state.level + 1 < LEVELS.length &&
            average_ms(state, state.level) > part;
          const under = state.level > 0 &&
            average_ms(state, state.level - 1) < part * STEP_UP_HEADROOM;
          demand = over ? 1 : under ? -1 : 0;
        }
        const next = adjusted(state, demand, time);
        if (next !== state) states.set(item, next);
      }
    },
  };
}
