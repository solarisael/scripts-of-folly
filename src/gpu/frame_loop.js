// The frame loop of the GPU text effects. This module owns the schedule of
// the next frame and the picture of each visible effect.
//
// States:
//   idle     No frame is planned.
//   waiting  A timer holds the next frame until the fps setting permits it.
//   queued   An animation frame is requested.
//   drawing  A frame is on the GPU. A new request has no effect until it ends.
//
// `invalidate()` tells the loop that the picture is out of date. With reduced
// motion the loop draws only an invalid picture, then stops.
import { LEVELS } from "./budget.js";
import { PANEL_READY_ATTRIBUTE, TEXT_READY_ATTRIBUTE } from "./markers.js";
import { effect_dpr, present_tile } from "./presentation.js";
import { is_element } from "./targets.js";
import { visible_clip } from "./visibility.js";

// Lays the visible effects out in rows on the one source canvas, in device
// pixels, so one pass draws all of them and the frame waits for the GPU once.
// A batch stays within MAX_ATLAS_PIXELS on each side (the WebGL2 leg's safe
// texture size); more effects start another batch. An effect larger than
// that gets a batch of its own, as before.
const MAX_ATLAS_PIXELS = 4096;
const ATLAS_GAP = 2;

function pack_atlas(entries, dpr) {
  const batches = [];
  let batch = null;
  let x = 0;
  let y = 0;
  let row_height = 0;
  const start_batch = () => {
    batch = { tiles: [], width: 1, height: 1 };
    batches.push(batch);
    x = 0;
    y = 0;
    row_height = 0;
  };
  for (const entry of entries) {
    const width = Math.max(1, Math.ceil(entry.item.width * dpr));
    const height = Math.max(1, Math.ceil(entry.item.height * dpr));
    if (!batch) start_batch();
    if (x > 0 && x + width > MAX_ATLAS_PIXELS) {
      x = 0;
      y += row_height + ATLAS_GAP;
      row_height = 0;
    }
    if (y > 0 && y + height > MAX_ATLAS_PIXELS) start_batch();
    batch.tiles.push({ entry, x, y, width, height });
    batch.width = Math.max(batch.width, x + width);
    batch.height = Math.max(batch.height, y + height);
    x += width + ATLAS_GAP;
    row_height = Math.max(row_height, height);
  }
  return batches;
}

// `items` is the live map of target to item. `lifecycle` gives the renderer.
// `restore_target(target)` shows a target as native text.
export function create_frame_loop({
  view,
  document_value,
  root,
  items,
  budget,
  lifecycle,
  restore_target,
}) {
  let animation_frame = 0;
  let frame_timer = 0;
  let draw_promise = null;
  let render_dirty = true;
  let animation_time = 0;
  let previous_frame_time = null;
  let empty_frame_cleared = false;
  // Recent gaps between drawn frames, for a page at display refresh. The
  // shortest one is the refresh: a slow frame only adds longer gaps.
  const recent_gaps = [];

  function current_reduced_motion() {
    return (
      view.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    );
  }

  function current_fps() {
    const sources = [
      document_value.documentElement,
      document_value.body,
      is_element(root) ? root : null,
    ];
    for (const source of sources) {
      const value = source?.getAttribute("data-site-fps");
      if (!value) continue;
      if (/display|refresh/i.test(value)) return 0;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 60;
  }

  // The frame interval the budget divides: the fps setting, or the display
  // refresh. It never comes from the loop's own pace, or a slow frame would
  // grow the interval and slow the next one.
  function current_frame_ms(frame_time) {
    const fps = current_fps();
    if (fps > 0) return 1000 / fps;
    if (previous_frame_time != null) {
      const gap = frame_time - previous_frame_time;
      if (gap > 2 && gap < 100) recent_gaps.push(gap);
      if (recent_gaps.length > 60) recent_gaps.shift();
    }
    return recent_gaps.length ? Math.min(...recent_gaps) : 1000 / 60;
  }

  // data-folly-gpu-level shows the budget level of an effect (0 is full).
  function show_level(item) {
    const level = String(LEVELS.indexOf(budget.level_of(item)));
    if (item.target.getAttribute("data-folly-gpu-level") !== level)
      item.target.setAttribute("data-folly-gpu-level", level);
  }

  // Any state -> idle. A frame on the GPU still ends.
  function stop() {
    if (animation_frame) view.cancelAnimationFrame(animation_frame);
    if (frame_timer) view.clearTimeout(frame_timer);
    animation_frame = 0;
    frame_timer = 0;
    previous_frame_time = null;
  }

  // idle -> waiting or queued.
  function schedule() {
    if (
      lifecycle.dead ||
      !lifecycle.renderer ||
      animation_frame ||
      frame_timer ||
      draw_promise
    )
      return;
    if (!render_dirty && current_reduced_motion()) return;

    const request = () => {
      frame_timer = 0;
      if (!lifecycle.dead)
        animation_frame = view.requestAnimationFrame(draw_frame);
    };
    const fps = current_fps();
    if (fps > 0 && previous_frame_time != null) {
      const delay = Math.max(
        0,
        1000 / fps - (view.performance?.now?.() - previous_frame_time),
      );
      if (delay > 1) {
        frame_timer = view.setTimeout(request, delay);
        return;
      }
    }
    animation_frame = view.requestAnimationFrame(draw_frame);
  }

  function item_entry(item) {
    if (!visible_clip(item, document_value, view)) {
      restore_target(item.target);
      return null;
    }
    return {
      item,
      handle: item.handle,
      rect: { left: 0, top: 0, width: item.width, height: item.height },
      clip: { left: 0, top: 0, right: item.width, bottom: item.height },
    };
  }

  // Draws the effects that are due, one batch for each render scale, and
  // copies each tile to its presenter.
  async function draw_entries(entries, frame_time, frame_ms) {
    // Each copy owns only its ink. DOM ancestors clip it when the page scrolls.
    const dpr = effect_dpr(view);
    budget.settle(
      entries.map(({ item }) => item),
      frame_ms,
    );
    // The effects due on this frame, grouped by render scale. The others
    // keep their last picture.
    const by_scale = new Map();
    for (const entry of entries) {
      if (!budget.due(entry.item, frame_time)) continue;
      const level = budget.level_of(entry.item);
      show_level(entry.item);
      if (!by_scale.has(level.scale)) by_scale.set(level.scale, []);
      by_scale.get(level.scale).push(entry);
    }
    for (const [scale, group] of by_scale) {
      const density = dpr * scale;
      for (const batch of pack_atlas(group, density)) {
        lifecycle.renderer.resize(
          batch.width / density,
          batch.height / density,
          dpr,
          scale,
        );
        // Record the draw before the GPU runs it: its GPU time can come
        // back before `render` resolves, and the budget needs the scale.
        for (const { entry } of batch.tiles) {
          budget.drawn(
            entry.item,
            frame_time,
            frame_ms,
            entry.item.width * entry.item.height * dpr * dpr,
            scale,
          );
        }
        await lifecycle.renderer.render(
          batch.tiles.map(({ entry, x, y }) => {
            const left = x / density;
            const top = y / density;
            const { width, height } = entry.item;
            return {
              handle: entry.handle,
              rect: { left, top, width, height },
              clip: {
                left,
                top,
                right: left + width,
                bottom: top + height,
              },
            };
          }),
          animation_time,
        );
        if (lifecycle.dead) return false;
        const source_canvas = lifecycle.renderer.canvas;
        for (const tile of batch.tiles) {
          // A refresh can dispose an item while the GPU draws.
          if (!tile.entry.item.presentation) continue;
          present_tile(tile.entry.item, source_canvas, tile, dpr);
        }
      }
    }
    for (const { item } of entries) {
      item.target.setAttribute(
        item.kind === "panel" ? PANEL_READY_ATTRIBUTE : TEXT_READY_ATTRIBUTE,
        "ready",
      );
    }
    return true;
  }

  // queued -> drawing -> idle, or -> queued again while the effects move.
  async function draw_frame(frame_time) {
    animation_frame = 0;
    if (
      lifecycle.dead ||
      !lifecycle.renderer ||
      document_value.visibilityState === "hidden"
    ) {
      stop();
      return;
    }
    if (draw_promise) return;

    let keep_animating = false;
    let retry_after_draw = false;
    draw_promise = (async () => {
      const entries = [];
      for (const item of items.values()) {
        const entry = item_entry(item);
        if (entry) entries.push(entry);
      }
      if (!entries.length) {
        if (!empty_frame_cleared) {
          await lifecycle.renderer.render([], 0);
          empty_frame_cleared = true;
        }
        render_dirty = false;
        stop();
        return;
      }
      empty_frame_cleared = false;
      // Before previous_frame_time moves on to this frame.
      const frame_ms = current_frame_ms(frame_time);
      if (current_reduced_motion()) {
        animation_time = 0;
      } else if (previous_frame_time != null) {
        animation_time += Math.max(0, frame_time - previous_frame_time) / 1000;
      }
      previous_frame_time = frame_time;

      try {
        if (!(await draw_entries(entries, frame_time, frame_ms))) return;
        render_dirty = false;
        keep_animating = !current_reduced_motion();
      } catch (error) {
        await lifecycle.recover(error);
        retry_after_draw = true;
      }
    })();
    try {
      await draw_promise;
    } finally {
      draw_promise = null;
      if (
        ((keep_animating && render_dirty === false) || retry_after_draw) &&
        !lifecycle.dead &&
        lifecycle.renderer
      )
        schedule();
    }
  }

  return {
    schedule,
    stop,
    invalidate() {
      render_dirty = true;
    },
    // The next frame does not count the time since the last one.
    reset_clock() {
      previous_frame_time = null;
    },
    // The promise of the frame on the GPU, or null.
    get drawing() {
      return draw_promise;
    },
  };
}
