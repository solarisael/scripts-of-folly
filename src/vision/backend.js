// The vision banner backend. It runs on whichever gpu it gets: vgpu on
// WebGPU, or the WebGL2 leg. Both legs run BANNER_WGSL; the WebGL2 leg reads
// its naga GLSL from ./glsl.generated.js.
import { BANNER_WGSL } from "./wgsl.js";
import { FRAG, VERT } from "./glsl.generated.js";
import { shader_module } from "../webgl2/shader_module.js";

const BANNER_SHADER = shader_module(BANNER_WGSL, { frag: FRAG, vert: VERT });

const canvas_format = (kind) =>
  kind === "webgpu"
    ? (globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm")
    : "rgba8unorm";

// `opened` is { kind, api, gpu } from open_gpu in ../gpu/open_gpu.js.
export const create_vision_backend = async (
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
  let sampler = null;
  let texture = null;
  let disposed = false;
  let remove_error = null;
  let lost_handled = false;
  let accepting_loss = false;
  let prepared = false;
  let initialization_error = null;
  const handles = new Set();

  const release = () => {
    if (disposed) return;

    disposed = true;
    remove_error?.();
    remove_error = null;
    for (const handle of handles) handle.dispose();
    handles.clear();
    sampler?.dispose?.();
    sampler = null;
    texture?.dispose?.();
    texture = null;
    draw = null;
    surface?.dispose?.();
    surface = null;
    gpu.dispose();
  };

  const lost = (reason) => {
    if (disposed || lost_handled) return;
    if (!accepting_loss || !prepared) {
      initialization_error = reason;
      return;
    }
    lost_handled = true;
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
      label: "folly-vision-banner-surface",
    });
    sampler = api.sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    texture = gpu.device.createTexture({
      kind: "2d",
      size: [1, 1],
      format: "rgba8unorm-srgb",
      usage: ["copy_dst", "texture_binding", "render_attachment"],
      label: "folly-vision-banner-image",
    });
    draw = api.draw(gpu, {
      shader: BANNER_SHADER,
      label: "folly-vision-banner",
      blend: "alpha",
      depth: false,
      vertices: 6,
    });

    draw.set({
      params: {
        canvas_size: [1, 1],
        image_size: [1, 1],
        time: 0,
        variant: 0,
      },
      image_texture: texture.view,
      image_sampler: sampler,
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

  const upload = async (image, width, height) => {
    if (disposed || !image || !width || !height) return;

    if (!texture || texture.size[0] !== width || texture.size[1] !== height) {
      texture?.dispose?.();
      texture = gpu.device.createTexture({
        kind: "2d",
        size: [width, height],
        format: "rgba8unorm-srgb",
        usage: ["copy_dst", "texture_binding", "render_attachment"],
        label: "folly-vision-banner-image",
      });
      draw.set({ image_texture: texture.view });
    }

    gpu.device.pushErrorScope("validation");
    let copy_error = null;
    try {
      gpu.gpu.queue.copyExternalImageToTexture(
        { source: image },
        { texture: texture.gpu, premultipliedAlpha: false },
        { width, height },
      );
    } catch (error_value) {
      copy_error = error_value;
    }
    const validation_error = await gpu.device.popErrorScope();
    if (copy_error) throw copy_error;
    if (validation_error) throw validation_error;
  };

  const backend = {
    canvas,
    backend: kind,
    resize(width, height, dpr = 1) {
      if (disposed) return;

      const physical_width = Math.max(1, Math.round(width * dpr));
      const physical_height = Math.max(1, Math.round(height * dpr));
      surface.resize([physical_width, physical_height]);
    },

    async prepare(captured) {
      if (disposed) return null;

      await upload(captured.image, captured.image_width, captured.image_height);

      const params = {
        canvas_size: [
          Math.max(1, captured.width),
          Math.max(1, captured.height),
        ],
        image_size: [
          Math.max(1, captured.image_width),
          Math.max(1, captured.image_height),
        ],
        time: 0,
        variant: captured.inverted_bowl ? 1 : 0,
      };
      draw.set({ params, image_sampler: sampler });
      await gpu.settled();

      if (initialization_error) throw initialization_error;

      prepared = true;
      const handle = {
        async set_image(image, width, height) {
          if (disposed) return;

          await upload(image, width, height);
          params.image_size = [Math.max(1, width), Math.max(1, height)];
        },
        resize(width, height) {
          params.canvas_size = [Math.max(1, width), Math.max(1, height)];
        },
        dispose() {
          handles.delete(handle);
        },
        _set_time(time_seconds) {
          params.time = time_seconds;
          draw.set({ params });
        },
      };
      handles.add(handle);
      return handle;
    },

    async render(entries, time_seconds) {
      if (disposed || !surface || !draw) return;

      for (const entry of entries ?? []) entry.handle?._set_time(time_seconds);

      api.frame(gpu, (current) => {
        current.pass(surface, (pass) => pass.draw(draw));
      });
      await gpu.settled();
    },

    dispose: release,
  };
  return backend;
};
