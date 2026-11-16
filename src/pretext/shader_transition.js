import { capture_text } from "../gpu/text_capture.js";
import { create_renderer, dispose_renderer } from "../gpu/renderer.js";

const PADDING = 32;
const SHADER_MODES = { dust: 1, fog: 2, crumble: 3, well: 4 };
const CANVAS_STYLE =
  "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";

// One stage for each document: a canvas over the viewport and its renderer.
// A stage stays open between transitions. The first draw of a new renderer
// compiles the shader, and that takes seconds on a software GPU.
// Document -> { stage, opening }. `stage` is null until `opening` resolves.
const stages = new WeakMap();
// A document that lost a WebGPU device opens its next stage on WebGL2.
const webgpu_lost = new WeakSet();

const viewport_of = (view) => ({
  width: view.innerWidth,
  height: view.innerHeight,
  dpr: Math.min(1.5, Math.max(1, view.devicePixelRatio || 1)),
});

// Draws one transparent pixel, so the shader compiles before a transition
// needs it.
async function draw_warm_frame(doc, renderer) {
  const pixel = doc.createElement("canvas");
  pixel.width = 1;
  pixel.height = 1;
  // WebGPU cannot copy from a canvas that has no context.
  pixel.getContext("2d");

  const handle = await renderer.prepare(
    { canvas: pixel, width: 1, height: 1 },
    [],
    [],
    "transition",
  );
  try {
    await renderer.render([
      {
        handle,
        rect: { left: 0, top: 0, width: 1, height: 1 },
        clip: { left: 0, top: 0, right: 1, bottom: 1 },
        transition: [SHADER_MODES.dust, 1, 1, 0],
      },
    ]);
  } finally {
    handle.dispose();
  }
}

async function open_stage(doc, backend, open_gpu) {
  const stage = { renderer: null, canvas: null, loss: null, busy: false };

  const first_canvas = doc.createElement("canvas");
  first_canvas.dataset.follyTransition = "";
  first_canvas.hidden = true;
  doc.body.append(first_canvas);

  // create_renderer removes the canvas when no backend opens.
  const renderer = await create_renderer(first_canvas, {
    backend: webgpu_lost.has(doc) ? "webgl2" : backend,
    open: open_gpu,
    on_lost: (error) => {
      stage.loss = error;
    },
  });

  // create_renderer gives a new canvas when it changes the backend.
  // The canvas must not have the class folly-gpu-canvas: that class is the
  // hidden atlas of the text effects (visibility: hidden in gpu.css). The
  // data-folly-transition attribute marks it for the mutation observers.
  const canvas = renderer.canvas;
  canvas.dataset.follyTransition = renderer.backend;
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  canvas.style.cssText = CANVAS_STYLE;

  try {
    const { width, height, dpr } = viewport_of(doc.defaultView);
    renderer.resize(width, height, dpr);
    await draw_warm_frame(doc, renderer);
  } catch (error) {
    dispose_renderer(renderer);
    canvas.remove();
    throw error;
  }

  stage.renderer = renderer;
  stage.canvas = canvas;
  return stage;
}

function close_stage(doc) {
  const stage = stages.get(doc)?.stage;
  stages.delete(doc);
  if (!stage) return;

  dispose_renderer(stage.renderer);
  stage.canvas.remove();
}

// Opens the stage of the document. Resolves to true when shader transitions
// can play, and to false when no GPU backend opens. The work starts one time
// for each document; later calls get the same promise. `open_gpu` is the
// host seam of ../gpu/open_gpu.js.
export function warm_shader_transitions(
  doc,
  { backend = "auto", open_gpu } = {},
) {
  const known = stages.get(doc);
  if (known) return known.opening;

  const entry = { stage: null, opening: null };
  entry.opening = open_stage(doc, backend, open_gpu).then(
    (stage) => {
      entry.stage = stage;
      return true;
    },
    (error) => {
      console.warn(
        "Folly shader transitions unavailable; transitions use native animation.",
        error,
      );
      return false;
    },
  );
  stages.set(doc, entry);

  return entry.opening;
}

// Gives the shader transition of `root`, or null when the stage cannot play
// now. A null result never waits: the caller plays its native animation, and
// the stage opens for the next transition.
export function create_shader_transition(
  root,
  { backend = "auto", open_gpu, signal },
) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const stage = stages.get(doc)?.stage;

  // enough: one shader transition for each document at a time, because one
  // render clears the whole canvas. Give each root its own renderer when two
  // roots must play shader transitions together.
  if (!stage || stage.busy) {
    warm_shader_transitions(doc, { backend, open_gpu });
    return null;
  }

  stage.busy = true;
  const { renderer, canvas } = stage;
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let items = [];
  let disposed = false;
  let finish_frame = null;

  const alive = () => !disposed && !signal.aborted && root.isConnected;

  const restore_items = () => {
    for (const item of items) {
      if (item.opacity)
        item.fragment.style.setProperty("opacity", item.opacity, item.priority);
      else item.fragment.style.removeProperty("opacity");
      item.handle?.dispose();
    }

    items = [];
  };

  const clip_rect = () => {
    const clip = {
      left: 0,
      top: 0,
      right: view.innerWidth,
      bottom: view.innerHeight,
    };

    for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if (/hidden|clip|scroll|auto/u.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left);
        clip.right = Math.min(clip.right, bounds.right);
      }
      if (/hidden|clip|scroll|auto/u.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top);
        clip.bottom = Math.min(clip.bottom, bounds.bottom);
      }
    }

    return clip;
  };

  // A lost device closes the stage. The caller plays its native animation,
  // and the next transition opens a new stage.
  const lose_stage = (error) => {
    if (renderer.backend === "webgpu") webgpu_lost.add(doc);
    close_stage(doc);
    throw error;
  };

  // `well` is a point in CSS pixels from the top left of `root`, or null.
  async function render_frame(progress_for, effect, travel, well) {
    if (stage.loss) lose_stage(stage.loss);
    if (!alive()) return;

    const { width, height, dpr } = viewport_of(view);
    renderer.resize(width, height, dpr);
    const clip = clip_rect();
    const origin = root.getBoundingClientRect();
    const entries = items.map((item, index) => {
      const bounds = item.fragment.getBoundingClientRect();
      const left = bounds.left - PADDING;
      const top = bounds.top - PADDING;
      return {
        handle: item.handle,
        rect: {
          left,
          top,
          width: item.captured.width,
          height: item.captured.height,
        },
        clip,
        transition: [
          well ? SHADER_MODES.well : SHADER_MODES[effect],
          progress_for(index),
          index + 1,
          0,
        ],
        travel: well
          ? [origin.left + well[0] - left, origin.top + well[1] - top, 0, 0]
          : [travel[0], travel[1], 0, 0],
      };
    });

    try {
      await renderer.render(entries);
    } catch (error) {
      if (!alive()) return;
      lose_stage(error);
    }
  }

  async function play(
    fragments,
    { phase, effect, travel, well, duration, stagger, multiplier },
  ) {
    restore_items();
    if (!alive()) return false;
    if (motion.matches || doc.hidden) return true;

    const { dpr } = viewport_of(view);
    for (const fragment of fragments) {
      const captured = capture_text(fragment, { dpr, padding: PADDING });
      if (!captured) throw new Error("Could not capture transition text");
      items.push({
        fragment,
        captured,
        opacity: fragment.style.getPropertyValue("opacity"),
        priority: fragment.style.getPropertyPriority("opacity"),
        handle: null,
      });
      if (phase === "in")
        fragment.style.setProperty("opacity", "0", "important");
    }

    if (!items.length) return true;

    for (const item of items) {
      item.handle = await renderer.prepare(item.captured, [], [], "transition");
      if (!alive()) return false;
    }
    if (motion.matches || doc.hidden) return true;

    // A page swap can remove the canvas from the body.
    if (!canvas.isConnected) doc.body.append(canvas);

    const phase_duration = Math.max(0, Number(duration) || 0) * multiplier;
    const phase_stagger = Math.max(0, Number(stagger) || 0) * multiplier;
    const total = phase_duration + phase_stagger * (items.length - 1);
    const start = view.performance.now();

    // The turn of each fragment in the stagger. A well takes the nearest
    // fragment first; the other motions go in text order.
    const turns = items.map((_, index) => index);
    if (well) {
      const origin = root.getBoundingClientRect();
      const distances = items.map((item) => {
        const bounds = item.fragment.getBoundingClientRect();
        return Math.hypot(
          bounds.left + bounds.width / 2 - origin.left - well[0],
          bounds.top + bounds.height / 2 - origin.top - well[1],
        );
      });
      const nearest_first = turns.toSorted(
        (a, b) => distances[a] - distances[b],
      );
      nearest_first.forEach((index, turn) => {
        turns[index] = turn;
      });
    }

    return new Promise((resolve, reject) => {
      let frame = 0;
      let settled = false;
      let timer = 0;
      let in_flight = null;
      let hidden = phase === "in";

      const finish = (result, error) => {
        if (settled) return;

        settled = true;
        view.cancelAnimationFrame(frame);
        view.clearTimeout(timer);
        doc.removeEventListener("visibilitychange", on_visibility);
        motion.removeEventListener("change", on_motion);
        finish_frame = null;
        const deliver = () => {
          if (error) reject(error);
          else resolve(result);
        };
        // A phase cannot replace captures while a frame still draws them.
        if (in_flight) in_flight.then(deliver, reject);
        else deliver();
      };
      const on_visibility = () => {
        if (doc.hidden) finish(true);
      };
      const on_motion = () => {
        if (motion.matches) finish(true);
      };
      finish_frame = () => finish(false);
      doc.addEventListener("visibilitychange", on_visibility);
      motion.addEventListener("change", on_motion);
      timer = view.setTimeout(() => finish(alive()), total + 250);

      const tick = async (now) => {
        if (settled) return;
        if (!alive() || items.some((item) => !root.contains(item.fragment))) {
          finish(false);
          return;
        }

        const elapsed = now - start;
        const progress_for = (index) => {
          const wait = turns[index] * phase_stagger;
          const local =
            phase_duration > 0
              ? Math.min(1, Math.max(0, (elapsed - wait) / phase_duration))
              : Number(elapsed >= wait);
          const eased = local * local * (3 - 2 * local);
          return phase === "out" ? eased : 1 - eased;
        };

        try {
          in_flight = render_frame(progress_for, effect, travel, well);
          await in_flight;
          if (settled) return;

          // The canvas shows only after this play drew on it, so the last
          // frame of an earlier transition never shows.
          canvas.hidden = false;
          if (!hidden) {
            for (const item of items)
              item.fragment.style.setProperty("opacity", "0", "important");
            hidden = true;
          }
          if (elapsed >= total) finish(true);
          else frame = view.requestAnimationFrame(tick);
        } catch (error) {
          finish(false, error);
        }
      };

      frame = view.requestAnimationFrame(tick);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    finish_frame?.();
    signal.removeEventListener("abort", dispose);
    restore_items();
    canvas.hidden = true;
    stage.busy = false;
  }

  signal.addEventListener("abort", dispose, { once: true });

  return { play, dispose };
}
