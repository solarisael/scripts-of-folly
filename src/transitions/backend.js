// The transition cover backend. It runs on whichever gpu it gets: vgpu on
// WebGPU, or the WebGL2 leg. Both legs run COVER_WGSL; the WebGL2 leg reads
// its naga GLSL from ./glsl.generated.js.
import { COVER_WGSL } from "./wgsl.js";
import { FRAG, VERT } from "./glsl.generated.js";
import { shader_module } from "../webgl2/shader_module.js";

const COVER_SHADER = shader_module(COVER_WGSL, { frag: FRAG, vert: VERT });

const canvas_format = (kind) =>
  kind === "webgpu"
    ? (globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm")
    : "rgba8unorm";

// `opened` is { kind, api, gpu } from an open_gpu function.
export const create_cover_backend = async (
  canvas,
  { kind, api, gpu },
  { is_alive = () => true, on_lost = () => {} } = {},
) => {
  if (!is_alive()) {
    gpu.dispose();
    return null;
  }

  let surface = null;
  let draw = null;
  let disposed = false;
  let remove_error = null;
  let accepting_loss = false;
  let initialization_error = null;

  const release = () => {
    if (disposed) return;

    disposed = true;
    remove_error?.();
    remove_error = null;
    draw = null;
    surface?.dispose?.();
    surface = null;
    gpu.dispose();
  };

  const lost = (reason) => {
    if (disposed) return;
    if (!accepting_loss) {
      initialization_error = reason;
      return;
    }
    accepting_loss = false;
    on_lost(reason);
  };
  gpu.gpu.lost.then(lost);
  remove_error = gpu.onError(lost);

  try {
    surface = api.surface(gpu, canvas, {
      autoResize: false,
      dpr: 1,
      format: canvas_format(kind),
      alphaMode: "premultiplied",
      colorSpace: "srgb",
      clearColor: [0, 0, 0, 0],
      label: "folly-transition-cover-surface",
    });
    draw = api.draw(gpu, {
      shader: COVER_SHADER,
      label: "folly-transition-cover",
      blend: "alpha",
      depth: false,
      vertices: 6,
    });
    await draw.compile({ colors: [canvas_format(kind)] });
    await gpu.settled();

    if (initialization_error) throw initialization_error;
    if (!is_alive()) {
      release();
      return null;
    }
    accepting_loss = true;
  } catch (error_value) {
    release();
    throw error_value;
  }

  return {
    canvas,
    backend: kind,
    resize(width, height) {
      if (disposed) return;

      surface.resize([Math.max(1, width), Math.max(1, height)]);
    },
    // `cover` holds the Cover struct fields of COVER_WGSL.
    async render(cover) {
      if (disposed) return;

      draw.set({ cover });
      api.frame(gpu, (current) => {
        current.pass(surface, (pass) => pass.draw(draw));
      });
      await gpu.settled();
    },
    dispose: release,
  };
};
