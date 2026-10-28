import { create_vision_backend } from "./backend.js";
import { open_gpu } from "../gpu/open_gpu.js";

const fresh_canvas = (canvas) => {
  const replacement = canvas.cloneNode(false);
  canvas.replaceWith(replacement);
  return replacement;
};

const load_backend = async (backend_name, canvas, options) => {
  const opened = await open_gpu(backend_name, {
    label: "folly-vision-banner",
  });
  return create_vision_backend(canvas, opened, options);
};

export const create_renderer = async (
  canvas,
  { backend = "auto", is_alive = () => true, on_lost = () => {} } = {},
) => {
  if (!canvas || !is_alive()) return null;
  const errors = [];
  let render_canvas = canvas;

  if (backend === "webgl2") {
    const fallback = await load_backend("webgl2", render_canvas, {
      is_alive,
      on_lost,
    });
    if (!fallback) return null;
    return fallback;
  }

  try {
    const primary = await load_backend("webgpu", render_canvas, {
      is_alive,
      on_lost,
    });
    if (primary) return primary;
  } catch (error) {
    errors.push(error);
  }
  if (!is_alive()) return null;

  render_canvas = fresh_canvas(render_canvas);
  try {
    const fallback = await load_backend("webgl2", render_canvas, {
      is_alive,
      on_lost,
    });
    if (fallback) return fallback;
  } catch (error) {
    errors.push(error);
  }

  throw new AggregateError(
    errors,
    "Folly vision renderer initialization failed",
  );
};
