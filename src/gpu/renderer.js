import { create_gpu_backend } from "./backend.js";
import { open_gpu } from "./open_gpu.js";

export { open_gpu };

function fresh_canvas(previous_canvas) {
  const document_value = previous_canvas?.ownerDocument;
  if (!document_value) return null;

  const next_canvas = document_value.createElement("canvas");
  next_canvas.className = previous_canvas.className;
  next_canvas.ariaHidden = "true";
  if (previous_canvas.parentNode) {
    previous_canvas.replaceWith(next_canvas);
  }
  return next_canvas;
}

function backend_attempts(requested_backend) {
  return requested_backend === "webgl2" ? ["webgl2"] : ["webgpu", "webgl2"];
}

export async function create_renderer(
  canvas,
  {
    backend = "auto",
    is_alive = () => true,
    on_lost = () => {},
    open = open_gpu,
  } = {},
) {
  const errors = [];
  let current_canvas = canvas;

  const attempts = backend_attempts(backend);
  for (
    let attempt_index = 0;
    attempt_index < attempts.length;
    attempt_index += 1
  ) {
    if (!current_canvas || !is_alive()) return null;

    let backend_state = null;
    try {
      const opened = await open(attempts[attempt_index]);
      backend_state = await create_gpu_backend(current_canvas, opened, {
        is_alive,
        on_lost,
      });
      if (backend_state && backend_state.backend !== opened.kind) {
        throw new Error(`Invalid ${opened.kind} backend state`);
      }
      return backend_state;
    } catch (error) {
      errors.push(error);
      dispose_renderer(backend_state);
      if (attempt_index < attempts.length - 1) {
        current_canvas = fresh_canvas(current_canvas);
      } else {
        current_canvas.remove();
        current_canvas = null;
      }
    }
  }

  throw new AggregateError(errors, "GPU backend initialization failed");
}

export function dispose_renderer(renderer_state) {
  if (!renderer_state) return;

  try {
    renderer_state.dispose?.();
  } catch (error) {
    return error;
  }
  return null;
}
