import { capture_text } from "../gpu/text_capture.js";
import { create_renderer, dispose_renderer } from "../gpu/renderer.js";

const PADDING = 32;

export function create_shader_transition(root, { backend = "auto", signal }) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let renderer = null;
  let canvas = null;
  let items = [];
  let disposed = false;
  let loss = null;
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

  const viewport = () => ({
    width: view.innerWidth,
    height: view.innerHeight,
    dpr: Math.min(1.5, Math.max(1, view.devicePixelRatio || 1)),
  });

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

  async function prepare_renderer(requested_backend) {
    canvas = doc.createElement("canvas");
    canvas.className = "folly-gpu-canvas";
    canvas.dataset.follyTransition = "";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
    doc.body.append(canvas);

    const created = await create_renderer(canvas, {
      backend: requested_backend,
      is_alive: alive,
      on_lost: (error) => {
        loss = error;
      },
    });
    if (!created)
      throw new Error("Shader transition initialization was interrupted");
    if (!alive()) {
      dispose_renderer(created);
      created.canvas?.remove();
      throw new Error("Shader transition became stale");
    }

    renderer = created;
    canvas = renderer.canvas;
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000";
    canvas.dataset.follyTransition = renderer.backend;
    const { width, height, dpr } = viewport();
    renderer.resize(width, height, dpr);

    for (const item of items) {
      item.handle = await renderer.prepare(item.captured, [], [], "transition");
      if (!alive()) throw new Error("Shader transition capture became stale");
    }
  }

  async function recover() {
    if (renderer?.backend !== "webgpu") throw loss;

    for (const item of items) {
      item.handle?.dispose();
      item.handle = null;
    }
    dispose_renderer(renderer);
    renderer = null;
    canvas?.remove();
    loss = null;

    await prepare_renderer("webgl2");
  }

  async function render_frame(progress_for, effect) {
    if (loss) await recover();
    if (!alive()) return;

    const { width, height, dpr } = viewport();
    renderer.resize(width, height, dpr);
    const clip = clip_rect();
    const entries = items.map((item, index) => {
      const bounds = item.fragment.getBoundingClientRect();
      return {
        handle: item.handle,
        rect: {
          left: bounds.left - PADDING,
          top: bounds.top - PADDING,
          width: item.captured.width,
          height: item.captured.height,
        },
        clip,
        transition: [
          effect === "fog" ? 2 : 1,
          progress_for(index),
          index + 1,
          0,
        ],
      };
    });

    try {
      await renderer.render(entries);
    } catch (error) {
      if (!alive()) return;
      loss = error;
      await recover();
      await render_frame(progress_for, effect);
    }
  }

  async function play(
    fragments,
    { phase, effect, duration, stagger, multiplier },
  ) {
    restore_items();
    if (!alive()) return false;
    if (motion.matches || doc.hidden) return true;

    const { dpr } = viewport();
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

    if (!renderer) await prepare_renderer(backend);
    else {
      for (const item of items) {
        item.handle = await renderer.prepare(
          item.captured,
          [],
          [],
          "transition",
        );
        if (!alive()) return false;
      }
    }
    if (!alive()) return false;
    if (motion.matches || doc.hidden) return true;

    const phase_duration = Math.max(0, Number(duration) || 0) * multiplier;
    const phase_stagger = Math.max(0, Number(stagger) || 0) * multiplier;
    const total = phase_duration + phase_stagger * (items.length - 1);
    const start = view.performance.now();

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
        // A phase cannot replace captures while backend recovery still owns them.
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
          const local =
            phase_duration > 0
              ? Math.min(
                  1,
                  Math.max(
                    0,
                    (elapsed - index * phase_stagger) / phase_duration,
                  ),
                )
              : Number(elapsed >= index * phase_stagger);
          const eased = local * local * (3 - 2 * local);
          return phase === "out" ? eased : 1 - eased;
        };

        try {
          in_flight = render_frame(progress_for, effect);
          await in_flight;
          if (settled) return;
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
    dispose_renderer(renderer);
    renderer = null;
    canvas?.remove();
  }

  signal.addEventListener("abort", dispose, { once: true });

  return { play, dispose };
}
