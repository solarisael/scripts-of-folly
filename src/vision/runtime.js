import { create_renderer } from "./renderer.js";
import {
  observe_effect_visibility,
  observe_effect_size,
  disconnect_effect_observers,
} from "./visibility.js";
import {
  minimum_frame_interval,
  create_frame_state,
  advance_frame_clock,
} from "./frame_state.js";

const reduced_motion_query = "(prefers-reduced-motion: reduce)";

const current_size = (canvas, dpr_cap) => {
  const rect = canvas.getBoundingClientRect?.() ?? {
    width: canvas.clientWidth || 1,
    height: canvas.clientHeight || 1,
  };
  const dpr = Math.min(
    Math.max(globalThis.window?.devicePixelRatio || 1, 1),
    dpr_cap,
  );
  return {
    width: Math.max(1, Math.round(rect.width || 1)),
    height: Math.max(1, Math.round(rect.height || 1)),
    dpr,
  };
};

const read_frame_rate = (maximum_frame_rate) => {
  if (maximum_frame_rate === "display") return 0;
  const value = Number(maximum_frame_rate);
  return Number.isFinite(value) && value > 0 ? value : 60;
};

export const create_gpu_effect_runtime = async ({
  owner,
  canvas,
  image,
  image_width,
  image_height,
  inverted_bowl = false,
  backend = "auto",
  is_owner_alive = () => true,
  on_first_frame = () => {},
  on_renderer_reset = () => {},
  on_error = () => {},
  maximum_frame_rate = 60,
  dpr_cap = 2,
}) => {
  let render_canvas = canvas;
  let renderer = null;
  let handle = null;
  let rebuilding = false;
  let fallback_attempted = backend === "webgl2";
  let current_image = image;
  let current_image_width = image_width;
  let current_image_height = image_height;

  const state = create_frame_state(owner);
  const listener_cleanups = [];
  const alive = () =>
    !state.disposed && is_owner_alive() && owner?.isConnected !== false;
  const active = () => alive() && state.document_visible && state.owner_visible;

  const dispose_renderer = () => {
    handle?.dispose?.();
    handle = null;
    renderer?.dispose?.();
    renderer = null;
  };

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    cancel_frame();
    disconnect_effect_observers(state, listener_cleanups);
    dispose_renderer();
  };

  const request_frame = () => {
    if (
      !active() ||
      state.frame !== null ||
      state.rendering ||
      typeof globalThis.requestAnimationFrame !== "function"
    )
      return;
    if (state.motion_reduced && !state.needs_render) return;
    state.frame = globalThis.requestAnimationFrame(draw_frame);
  };

  const update_activity = () => {
    if (!alive()) {
      dispose();
      return;
    }
    if (!active()) {
      cancel_frame();
      state.last_frame_time = null;
      return;
    }
    request_frame();
  };

  const invalidate = () => {
    if (!alive()) {
      dispose();
      return;
    }
    state.needs_render = true;
    request_frame();
  };

  function cancel_frame() {
    if (state.frame === null) return;
    globalThis.cancelAnimationFrame?.(state.frame);
    state.frame = null;
  }

  const initialize_renderer = async (canvas_to_use, mode) => {
    const next_renderer = await create_renderer(canvas_to_use, {
      backend: mode,
      is_alive: alive,
      on_lost: (reason) => void handle_renderer_loss(reason),
    });
    if (!next_renderer || !alive()) {
      next_renderer?.dispose?.();
      return null;
    }
    try {
      const next_size = current_size(next_renderer.canvas, dpr_cap);
      next_renderer.resize(next_size.width, next_size.height, next_size.dpr);
      const next_handle = await next_renderer.prepare({
        image: current_image,
        image_width: current_image_width,
        image_height: current_image_height,
        width: next_size.width,
        height: next_size.height,
        inverted_bowl,
      });
      if (!next_handle || !alive()) {
        next_handle?.dispose?.();
        next_renderer.dispose?.();
        return null;
      }
      next_handle.resize(next_size.width, next_size.height);
      return { renderer: next_renderer, handle: next_handle };
    } catch (error_value) {
      const failed_backend = next_renderer.backend;
      next_renderer.dispose?.();
      if (mode === "auto" && failed_backend === "webgpu" && alive()) {
        const replacement = canvas_to_use.cloneNode(false);
        canvas_to_use.replaceWith(replacement);
        render_canvas = replacement;
        return initialize_renderer(replacement, "webgl2");
      }
      throw error_value;
    }
  };

  const rebuild_with_webgl = async (reason) => {
    if (rebuilding || state.disposed || !alive()) return;
    rebuilding = true;
    on_renderer_reset(reason);
    state.first_frame_rendered = false;
    state.last_frame_time = null;
    state.elapsed_ms = 0;
    state.needs_render = true;
    const old_renderer = renderer;
    const old_canvas = render_canvas;
    handle = null;
    renderer = null;
    old_renderer?.dispose?.();
    if (!alive()) {
      rebuilding = false;
      dispose();
      return;
    }
    const replacement = old_canvas.cloneNode(false);
    old_canvas.replaceWith(replacement);
    render_canvas = replacement;
    try {
      const initialized = await initialize_renderer(replacement, "webgl2");
      if (!initialized || !alive()) {
        initialized?.renderer?.dispose?.();
        initialized?.handle?.dispose?.();
        dispose();
        on_error(reason);
        return;
      }
      renderer = initialized.renderer;
      handle = initialized.handle;
      fallback_attempted = true;
      state.needs_render = true;
      update_activity();
    } catch (error_value) {
      dispose();
      on_error(error_value);
    } finally {
      rebuilding = false;
    }
  };

  async function handle_renderer_loss(reason) {
    if (!alive() || rebuilding) return;
    if (renderer?.backend === "webgpu" && !fallback_attempted) {
      await rebuild_with_webgl(reason);
      return;
    }
    dispose();
    on_error(reason);
  }

  async function draw_frame(frame_time) {
    state.frame = null;
    if (!active()) {
      state.last_frame_time = null;
      return;
    }
    const minimum_frame_ms = minimum_frame_interval(
      read_frame_rate(maximum_frame_rate),
    );
    if (
      !state.motion_reduced &&
      state.last_frame_time !== null &&
      frame_time - state.last_frame_time < minimum_frame_ms - 0.5
    ) {
      request_frame();
      return;
    }

    advance_frame_clock(state, frame_time);
    state.needs_render = false;
    state.rendering = true;
    try {
      const size = current_size(render_canvas, dpr_cap);
      if (
        size.width !== state.size.width ||
        size.height !== state.size.height ||
        size.dpr !== state.size.dpr
      ) {
        state.size = size;
        renderer.resize(size.width, size.height, size.dpr);
        handle.resize(size.width, size.height);
      }
      await renderer.render(
        [
          {
            handle,
            rect: { left: 0, top: 0, width: size.width, height: size.height },
            clip: { left: 0, top: 0, right: size.width, bottom: size.height },
          },
        ],
        state.motion_reduced ? 0 : state.elapsed_ms / 1000,
      );
      if (!alive()) {
        dispose();
        return;
      }
      if (!state.first_frame_rendered) {
        state.first_frame_rendered = true;
        on_first_frame(renderer.backend);
      }
    } catch (error_value) {
      await handle_renderer_loss(error_value);
      return;
    } finally {
      state.rendering = false;
    }
    request_frame();
  }

  const initialized = await initialize_renderer(canvas, backend);
  if (!initialized || !alive()) {
    initialized?.renderer?.dispose?.();
    initialized?.handle?.dispose?.();
    return null;
  }
  renderer = initialized.renderer;
  handle = initialized.handle;
  render_canvas = renderer.canvas;

  const handle_resize = () => {
    if (!alive()) {
      dispose();
      return;
    }
    invalidate();
  };
  try {
    observe_effect_size(
      owner,
      render_canvas,
      state,
      listener_cleanups,
      handle_resize,
    );
    observe_effect_visibility(owner, state, listener_cleanups, update_activity);
    const motion = globalThis.window?.matchMedia?.(reduced_motion_query);
    if (motion?.addEventListener) {
      const listener = () => {
        state.motion_reduced = motion.matches === true;
        state.last_frame_time = null;
        invalidate();
      };
      motion.addEventListener("change", listener);
      listener_cleanups.push(() =>
        motion.removeEventListener("change", listener),
      );
    } else if (motion?.addListener) {
      const listener = () => {
        state.motion_reduced = motion.matches === true;
        state.last_frame_time = null;
        invalidate();
      };
      motion.addListener(listener);
      listener_cleanups.push(() => motion.removeListener(listener));
    }
    state.size = current_size(render_canvas, dpr_cap);
    renderer.resize(state.size.width, state.size.height, state.size.dpr);
    handle.resize(state.size.width, state.size.height);
    request_frame();
    return {
      backend: renderer.backend,
      dispose,
      invalidate,
      set_image(next_image, next_width, next_height) {
        current_image = next_image;
        current_image_width = next_width;
        current_image_height = next_height;
        const upload = handle?.set_image?.(next_image, next_width, next_height);
        upload?.catch?.((error_value) => handle_renderer_loss(error_value));
        invalidate();
      },
    };
  } catch (error_value) {
    dispose();
    throw error_value;
  }
};
