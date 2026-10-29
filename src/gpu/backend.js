// The text-effect backend. It runs on whichever gpu it gets: vgpu on WebGPU,
// or the WebGL2 leg in ../webgl2/. Both legs run the same WGSL; the WebGL2 leg
// reads its naga GLSL from ./glsl.generated.js.
import { WGSL_SOURCE, EFFECT_SLOTS, EFFECT_SLOT_COUNT } from "./wgsl.js";
import { FRAG, VERT } from "./glsl.generated.js";
import { shader_module } from "../webgl2/shader_module.js";

const SHADER = shader_module(WGSL_SOURCE, { frag: FRAG, vert: VERT });

const EFFECT_COUNT = EFFECT_SLOT_COUNT;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function color(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return fallback;
  return [finite(value[0]), finite(value[1]), finite(value[2])];
}

function physical_size(canvas, captured) {
  const source_width = finite(canvas?.width, 0);
  const source_height = finite(canvas?.height, 0);
  const width = Math.max(
    1,
    Math.round(source_width || finite(captured?.width, 1)),
  );
  const height = Math.max(
    1,
    Math.round(source_height || finite(captured?.height, 1)),
  );
  return [width, height];
}

function pack_effects(effect_names, parameter_sets) {
  const settings = Array.from(
    { length: EFFECT_COUNT },
    () => new Float32Array(4),
  );
  const colors = Array.from(
    { length: EFFECT_COUNT },
    () => new Float32Array(4),
  );
  const order = Array.from({ length: EFFECT_COUNT }, () => new Float32Array(4));
  const order_count = new Float32Array(4);
  for (let i = 0; i < effect_names.length; i += 1) {
    const slot = EFFECT_SLOTS[effect_names[i]];
    if (slot === undefined)
      throw new Error(`Unknown vgpu effect: ${effect_names[i]}`);
    order[i][0] = slot;
    const params = parameter_sets?.[i] ?? {};
    const settings_row = settings[slot];
    settings_row[0] = finite(params.intensity);
    settings_row[1] = finite(params.motion, 1);
    settings_row[2] = finite(params.speed, 1);
    settings_row[3] = finite(params.font_size);
    colors[slot].set(color(params.accent));
    if (slot === EFFECT_SLOTS.rift && params.color_override)
      colors[slot][3] = 1;
  }
  order_count[0] = Math.min(EFFECT_COUNT, effect_names.length);
  return { settings, colors, order, order_count };
}

function set_initial_values(drawable, captured, packed, kind) {
  const base_color = color(captured.base_color, [1, 1, 1]);
  const width = Math.max(1, finite(captured.width, 1));
  const height = Math.max(1, finite(captured.height, 1));

  drawable.set({
    frame: [width, height, 0, 1],
    rect: [0, 0, width, height],
    clip: [0, 0, width, height],
    surface: [
      width,
      height,
      Math.max(1, finite(captured.font_size, 16)),
      kind === "panel" ? 1 : 0,
    ],
    base: [...base_color, 1],
    settings: packed.settings,
    colors: packed.colors,
    order: packed.order,
    order_count: packed.order_count,
  });
}

function update_values(handle, entry, time_seconds, viewport) {
  const { drawable, captured, settings, colors, order, order_count, kind } =
    handle;
  const rect = entry.rect;
  const clip = entry.clip;
  const width = Math.max(1, finite(captured.width, rect.width));
  const height = Math.max(1, finite(captured.height, rect.height));
  const base_color = color(captured.base_color, [1, 1, 1]);

  handle.frame_values[0] = Math.max(1, finite(viewport.width, width));
  handle.frame_values[1] = Math.max(1, finite(viewport.height, height));
  handle.frame_values[2] = finite(time_seconds);
  handle.frame_values[3] = Math.max(1, finite(viewport.dpr, 1));

  handle.rect_values[0] = finite(rect.left);
  handle.rect_values[1] = finite(rect.top);
  handle.rect_values[2] = Math.max(1, finite(rect.width, width));
  handle.rect_values[3] = Math.max(1, finite(rect.height, height));

  handle.clip_values[0] = finite(clip.left);
  handle.clip_values[1] = finite(clip.top);
  handle.clip_values[2] = finite(
    clip.right,
    handle.rect_values[0] + handle.rect_values[2],
  );
  handle.clip_values[3] = finite(
    clip.bottom,
    handle.rect_values[1] + handle.rect_values[3],
  );

  handle.surface_values[0] = width;
  handle.surface_values[1] = height;
  handle.surface_values[2] = Math.max(1, finite(captured.font_size, 16));
  handle.surface_values[3] = kind === "panel" ? 1 : 0;
  handle.base_values[0] = base_color[0];
  handle.base_values[1] = base_color[1];
  handle.base_values[2] = base_color[2];
  handle.base_values[3] = 1;

  handle.transition_values.set(entry.transition ?? [0, 0, 0, 0]);
  drawable.set({
    frame: handle.frame_values,
    rect: handle.rect_values,
    clip: handle.clip_values,
    surface: handle.surface_values,
    base: handle.base_values,
    settings,
    colors,
    order,
    order_count,
    transition: handle.transition_values,
  });
}

async function copy_capture(gpu, texture, captured, width, height) {
  if (!captured?.canvas) throw new Error("vgpu capture has no canvas");

  const queue = gpu.gpu?.queue;
  if (!queue || typeof queue.copyExternalImageToTexture !== "function") {
    throw new Error("vgpu native queue cannot upload a capture");
  }
  gpu.gpu.pushErrorScope?.("validation");
  try {
    queue.copyExternalImageToTexture(
      { source: captured.canvas, flipY: false },
      { texture: texture.gpu, premultipliedAlpha: false, colorSpace: "srgb" },
      { width, height, depthOrArrayLayers: 1 },
    );
  } catch (error) {
    await gpu.gpu.popErrorScope?.();
    throw error;
  }
  const error = await gpu.gpu.popErrorScope?.();
  if (error) throw error;
}

// `opened` is { kind, api, gpu } from renderer.js: the vgpu module or the
// WebGL2 leg, and the gpu its init() returned.
export async function create_gpu_backend(
  canvas,
  opened,
  {
    is_alive = () => true,
    on_lost = () => {},
    // Called with (handle, ms) when the GPU time of one effect's draw is
    // known, one or two frames after the draw. Only on WebGPU with the
    // "timestamp-query" feature.
    on_gpu_time = () => {},
  } = {},
) {
  const { kind: backend_kind, api, gpu } = opened;
  if (!canvas || typeof canvas.getContext !== "function") {
    gpu.dispose();
    throw new Error("GPU backend requires a canvas");
  }
  if (!is_alive()) {
    gpu.dispose();
    return null;
  }

  const canvas_format =
    backend_kind === "webgpu"
      ? (navigator.gpu.getPreferredCanvasFormat?.() ?? "bgra8unorm")
      : "rgba8unorm";
  let disposed = false;
  let loss_notified = false;
  const handles = new Set();
  let current_size = physical_size(canvas, {
    width: canvas.width,
    height: canvas.height,
  });
  let current_dpr = 1;
  // Device pixels per CSS pixel of the surface: dpr times the render scale.
  // The shader keeps the real dpr, so a lower scale changes only the pixel
  // count, not the look.
  let current_density = 1;
  let canvas_surface;
  let unsubscribe_error;
  let unsubscribe_uncaptured = () => {};

  const notify_lost = (reason) => {
    if (disposed || loss_notified) return;
    loss_notified = true;
    on_lost(reason);
  };

  try {
    canvas_surface = api.surface(gpu, canvas, {
      autoResize: false,
      size: current_size,
      dpr: 1,
      format: canvas_format,
      colorSpace: "srgb",
      label: "folly-vgpu.surface",
    });

    unsubscribe_error = gpu.onError((error) => notify_lost(error));
    if (typeof gpu.gpu?.addEventListener === "function") {
      const on_uncaptured = (event) => notify_lost(event.error ?? event);
      gpu.gpu.addEventListener("uncapturederror", on_uncaptured);
      unsubscribe_uncaptured = () =>
        gpu.gpu.removeEventListener?.("uncapturederror", on_uncaptured);
    }

    if (gpu.gpu?.lost && typeof gpu.gpu.lost.then === "function") {
      gpu.gpu.lost.then((info) => notify_lost(info));
    }
  } catch (error) {
    gpu.dispose();
    throw error;
  }

  // GPU timing: each effect draws in its own pass, and the pass reports its
  // time under the name of its handle. Without the feature all effects share
  // one pass, untimed.
  let timer = null;
  let unsubscribe_timer = () => {};
  const timed_handles = new Map();
  let next_span_id = 0;
  if (
    backend_kind === "webgpu" &&
    typeof api.timer === "function" &&
    gpu.gpu?.features?.has?.("timestamp-query")
  ) {
    try {
      timer = api.timer(gpu);
      unsubscribe_timer = timer.onResults((spans) => {
        for (const [name, ms] of Object.entries(spans)) {
          const handle = timed_handles.get(name);
          if (handle && !handle.disposed) on_gpu_time(handle, ms);
        }
      });
    } catch (error) {
      // Timing is optional: the effects draw the same without it, and the
      // frame budget then leaves them at full quality.
      console.warn("[Scripts of Folly] GPU timing unavailable", error);
      timer = null;
    }
  }
  const span_of = (handle) => {
    if (!handle.span) {
      handle.span_name = `fx${(next_span_id += 1)}`;
      handle.span = timer.span(handle.span_name);
      timed_handles.set(handle.span_name, handle);
    }
    return handle.span;
  };

  // `scale` (0 to 1) renders the surface with fewer pixels than the dpr asks.
  const resize = (width, height, dpr = 1, scale = 1) => {
    if (disposed) return;

    current_dpr = Math.max(1, finite(dpr, 1));
    current_density =
      current_dpr * Math.min(1, Math.max(0.1, finite(scale, 1)));
    const next_size = [
      Math.max(1, Math.round(finite(width, current_size[0]) * current_density)),
      Math.max(
        1,
        Math.round(finite(height, current_size[1]) * current_density),
      ),
    ];

    if (next_size[0] === current_size[0] && next_size[1] === current_size[1])
      return;
    canvas_surface.resize(next_size);
    current_size = next_size;
  };

  const prepare = async (
    captured,
    effect_names = [],
    parameter_sets = [],
    kind = "text",
  ) => {
    if (disposed || !is_alive()) throw new Error("vgpu backend is not alive");
    if (!captured?.canvas)
      throw new Error("vgpu prepare requires a captured canvas");

    const [texture_width, texture_height] = physical_size(
      captured.canvas,
      captured,
    );

    const capture = {
      ...captured,
      width: Math.max(1, finite(captured.width, texture_width)),
      height: Math.max(1, finite(captured.height, texture_height)),
    };

    const [width, height] = [capture.width, capture.height];
    const [upload_width, upload_height] = [texture_width, texture_height];
    const texture = gpu.device.createTexture({
      kind: "2d",
      label: "folly-vgpu.capture",
      size: [upload_width, upload_height],
      format: "rgba8unorm",
      usage: ["copy_dst", "texture_binding", "render_attachment"],
    });
    const soft_texture = captured.soft_canvas
      ? gpu.device.createTexture({
          kind: "2d",
          label: "folly-vgpu.soft-capture",
          size: [upload_width, captured.soft_canvas.height],
          format: "rgba8unorm",
          usage: ["copy_dst", "texture_binding", "render_attachment"],
        })
      : texture;

    let glyph_sampler;
    let packed;
    let drawable;
    try {
      glyph_sampler = api.sampler(gpu, {
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        addressModeW: "clamp-to-edge",
      });
      const resolved_base = parameter_sets.find(
        (values) => values?.base_color,
      )?.base_color;
      if (resolved_base) capture.base_color = resolved_base;
      packed = pack_effects(
        kind === "transition" ? [] : effect_names,
        parameter_sets,
      );

      drawable = api.draw(gpu, {
        label: `folly-vgpu.${kind}`,
        shader: SHADER,
        vertices: 6,
        blend: "alpha",
        depth: false,
        set: {
          glyph: texture,
          soft_glyph: soft_texture,
          glyph_sampler,
        },
      });

      await copy_capture(gpu, texture, captured, upload_width, upload_height);
      if (soft_texture !== texture)
        await copy_capture(
          gpu,
          soft_texture,
          { canvas: captured.soft_canvas },
          upload_width,
          captured.soft_canvas.height,
        );
      await drawable.compile({ colors: [canvas_format] });
      await gpu.settled();
    } catch (error) {
      texture.dispose();
      if (soft_texture !== texture) soft_texture.dispose();
      drawable?.dispose?.();
      throw error;
    }
    if (disposed || !is_alive()) {
      texture.dispose();
      if (soft_texture !== texture) soft_texture.dispose();
      drawable.dispose?.();
      throw new Error("vgpu prepare became stale");
    }

    const handle = {
      drawable,
      texture,
      soft_texture,
      glyph_sampler,
      captured: capture,
      settings: packed.settings,
      colors: packed.colors,
      order: packed.order,
      order_count: packed.order_count,
      kind,
      frame_values: new Float32Array([1, 1, 0, 1]),
      rect_values: new Float32Array([0, 0, width, height]),
      clip_values: new Float32Array([0, 0, width, height]),
      surface_values: new Float32Array([
        width,
        height,
        Math.max(1, finite(captured.font_size, 16)),
        kind === "panel" ? 1 : 0,
      ]),
      base_values: new Float32Array([
        ...color(capture.base_color, [1, 1, 1]),
        1,
      ]),
      transition_values: new Float32Array(4),
      disposed: false,
      dispose() {
        if (this.disposed) return;
        this.disposed = true;
        handles.delete(this);
        this.texture.dispose();
        if (this.soft_texture !== this.texture) this.soft_texture.dispose();
        this.drawable.dispose?.();
        if (this.span_name) timed_handles.delete(this.span_name);
      },
    };
    handles.add(handle);
    return handle;
  };

  const render = async (entries = [], time_seconds = 0) => {
    if (disposed || !is_alive()) return;
    const viewport = {
      width: current_size[0] / current_density,
      height: current_size[1] / current_density,
      dpr: current_dpr,
    };
    const live = entries.filter(
      (entry) =>
        entry?.handle && !entry.handle.disposed && handles.has(entry.handle),
    );
    api.frame(gpu, (current_frame) => {
      if (!timer || !live.length) {
        current_frame.pass(
          { target: canvas_surface, clear: [0, 0, 0, 0] },
          (pass) => {
            for (const entry of live) {
              update_values(entry.handle, entry, time_seconds, viewport);
              pass.draw(entry.handle.drawable);
            }
          },
        );
        return;
      }
      live.forEach((entry, index) => {
        update_values(entry.handle, entry, time_seconds, viewport);
        current_frame.pass(
          {
            target: canvas_surface,
            // The first pass clears the atlas; the others keep it.
            clear: index === 0 ? [0, 0, 0, 0] : false,
            timer: span_of(entry.handle),
          },
          (pass) => pass.draw(entry.handle.drawable),
        );
      });
    });
    await gpu.settled();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const handle of handles) handle.dispose();
    handles.clear();
    unsubscribe_error?.();
    unsubscribe_uncaptured();
    unsubscribe_timer();
    timer?.dispose();
    canvas_surface.dispose();
    gpu.dispose();
  };

  return {
    canvas,
    backend: backend_kind,
    timed: Boolean(timer),
    gpu,
    resize,
    prepare,
    render,
    dispose,
  };
}
