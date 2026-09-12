import { create_vision_banner_effect } from "./effect.js";

const backend_name = (renderer) =>
  renderer?.backend?.isWebGLBackend === true ? "webgl2" : null;

const dispose_renderer = (renderer) => {
  try {
    renderer?.dispose?.();
  } catch {
    // A failed fallback must still release the remaining owned resources.
  }
};

export const create_webgl_backend = async (
  canvas,
  { is_alive = () => true, on_lost = () => {} } = {},
) => {
  const [three, tsl] = await Promise.all([
    import("three/webgpu"),
    import("three/tsl"),
  ]);
  if (!is_alive()) return null;

  let renderer = null;
  let disposed = false;
  let loss_reported = false;
  let ready = false;
  let initialization_error = null;
  let remove_context_listener = null;
  try {
    renderer = new three.WebGPURenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      forceWebGL: true,
    });
    await renderer.init();
    if (!is_alive() || backend_name(renderer) !== "webgl2") {
      dispose_renderer(renderer);
      return null;
    }
    const report_loss = (error) => {
      if (disposed || loss_reported) return;
      if (!ready) {
        initialization_error = error;
        return;
      }
      loss_reported = true;
      on_lost(error);
    };
    canvas.addEventListener?.("webglcontextlost", report_loss);
    remove_context_listener = () =>
      canvas.removeEventListener?.("webglcontextlost", report_loss);

    const handles = new Set();
    const release = () => {
      if (disposed) return;
      disposed = true;
      remove_context_listener?.();
      remove_context_listener = null;
      for (const handle of handles) handle.dispose();
      handles.clear();
      dispose_renderer(renderer);
      renderer = null;
    };
    const backend = {
      canvas,
      backend: "webgl2",
      resize(width, height, dpr = 1) {
        if (disposed) return;
        renderer.setPixelRatio(dpr);
        renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      },
      async prepare(captured) {
        if (disposed || !is_alive()) return null;
        if (initialization_error) throw initialization_error;
        const effect = create_vision_banner_effect({
          three,
          tsl,
          renderer,
          image: captured.image,
          image_width: captured.image_width,
          image_height: captured.image_height,
          inverted_bowl: captured.inverted_bowl,
        });
        if (initialization_error) {
          effect.dispose();
          throw initialization_error;
        }
        const handle = {
          effect,
          set_image(image, width, height) {
            effect.set_image(image, width, height);
          },
          resize(width, height) {
            effect.resize({ width, height });
          },
          dispose() {
            if (!handles.delete(handle)) return;
            effect.dispose();
          },
          _render(time_seconds) {
            effect.render({ elapsed_seconds: time_seconds });
          },
        };
        handles.add(handle);
        ready = true;
        return handle;
      },
      render(entries, time_seconds) {
        if (disposed) return;
        for (const entry of entries ?? []) entry.handle?._render(time_seconds);
      },
      dispose: release,
    };
    return backend;
  } catch (error) {
    remove_context_listener?.();
    remove_context_listener = null;
    dispose_renderer(renderer);
    throw error;
  }
};
