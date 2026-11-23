import { draw_text } from "./text_frame.js";

// One clock for the page. A request while drawing belongs to the next
// frame, including a request from a reduced-motion text capture.
export function create_frame_loop({ view, document_value, texts, compositions, budget, lifecycle }) {
  let phase = "idle"; // idle | waiting | queued | drawing
  let tick = 0, timer = 0, drawing = null;
  let requested = false, text_dirty = true;
  let previous = null, seconds = 0, probe = null, continuous = false;
  const display_gaps = [];

  const reduced = () => view.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  function current_fps() {
    const fps = (source) => {
      const value = source?.getAttribute?.("data-site-fps");
      if (/display|refresh/i.test(value)) return 0;
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : null;
    };
    const page = fps(document_value.documentElement) ?? fps(document_value.body);
    if (page !== null) return page;
    for (const { root } of texts) {
      const local = fps(root);
      if (local !== null) return local;
    }
    return 60;
  }

  function request_tick() {
    if (!tick) tick = view.requestAnimationFrame(on_tick);
  }
  function on_tick(now) {
    tick = 0;
    if (probe !== null) {
      const interval = now - probe;
      if (interval > 2 && interval < 100) display_gaps.push(interval);
      if (display_gaps.length > 60) display_gaps.shift();
      probe = null;
    }
    if (phase === "queued") draw_frame(now);
  }
  function frame_interval(now) {
    const fps = current_fps();
    if (fps) return 1000 / fps;
    // The next display tick measures refresh even if this frame is still
    // on the GPU. If a draw is due then, it uses that very same callback.
    probe = now;
    request_tick();
    return display_gaps.length ? Math.min(...display_gaps) : 1000 / 60;
  }

  function stop() {
    if (tick) view.cancelAnimationFrame(tick);
    if (timer) view.clearTimeout(timer);
    tick = timer = 0;
    previous = probe = null;
    continuous = false;
    requested = false;
    if (phase !== "drawing") phase = "idle";
  }
  function queue() {
    phase = "queued";
    timer = 0;
    request_tick();
  }
  function schedule() {
    if (!lifecycle.renderer || lifecycle.dead || document_value.visibilityState === "hidden") return;
    if (phase === "drawing") { requested = true; return; }
    if (phase !== "idle") return;
    const fps = current_fps();
    const delay = fps && previous !== null ? previous + 1000 / fps - view.performance.now() : 0;
    if (delay > 1) {
      phase = "waiting";
      timer = view.setTimeout(queue, delay);
    } else queue();
  }

  async function draw_frame(now) {
    const renderer = lifecycle.renderer;
    const live = () => renderer === lifecycle.renderer && !lifecycle.dead;
    if (!renderer || document_value.visibilityState === "hidden") { stop(); return; }
    phase = "drawing";
    requested = false;
    let again = false;
    drawing = (async () => {
      const still = reduced();
      const text_items = [];
      if (!still || text_dirty) {
        for (const { items } of texts)
          for (const item of items.values())
            if (item.wants_frame(now)) text_items.push(item);
      }
      text_dirty = false;
      const scenes = [];
      for (const scene of compositions) {
        if (!scene.wants_frame(now)) continue;
        scenes.push(scene);
        if (scene.continues) again = true;
      }
      if (!still && text_items.length) again = true;
      const active = scenes.length ? text_items.concat(scenes) : text_items;
      if (!active.length) {
        budget.settle(active, 0);
        stop();
        return;
      }
      const frame_ms = frame_interval(now);
      const gap = !continuous || previous === null || (still && !scenes.length) ? null : now - previous;
      if (still) seconds = 0;
      else if (continuous && previous !== null) seconds += Math.max(0, now - previous) / 1000;
      previous = now;
      budget.settle(active, frame_ms, gap);
      let submitted = false;
      for (const scene of scenes) {
        if (!compositions.has(scene) || (!scene.requested && !budget.due(scene, now))) continue;
        if (await scene.draw(now, frame_ms, budget.level_of(scene))) submitted = true;
        if (!live()) return;
      }
      // An atlas batch already waits for all preceding scene submissions.
      const settled = text_items.length && await draw_text(
        text_items, renderer, budget, view, now, frame_ms, seconds, live,
      );
      if (submitted && !settled && live()) await renderer.gpu.settled();
    })();
    try {
      await drawing;
    } catch (error) {
      if (live()) await lifecycle.recover(error);
    } finally {
      drawing = null;
      phase = "idle";
      // Keep the last tick for the FPS cap, but never charge an idle gap.
      continuous = requested || (again && live());
      if (continuous) schedule();
    }
  }
  return {
    schedule, stop,
    invalidate() { text_dirty = true; if (phase === "drawing") requested = true; },
    reset_clock() { previous = null; },
    get drawing() { return drawing; },
  };
}
