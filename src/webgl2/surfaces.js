// Targets, surfaces and frame for the WebGL2 leg.
//
// A surface renders into its own framebuffer. After the frame callback
// returns, frame() presents each touched surface in pass order: blit the
// surface (flipped) into the top left corner of the hidden canvas, then copy
// that corner into the surface canvas with a 2d drawImage. A surface canvas
// must not hold another context already.

import { allocate_texture, create_texture } from "./textures.js";
import { encode } from "./programs.js";

const clear_values = (color) =>
  Array.isArray(color) ? color : [color.r, color.g, color.b, color.a];

const create_framebuffer_target = (gpu, size, format, label, clear_color) => {
  const { gl } = gpu;
  if (format !== "rgba8unorm" && !gpu.float_targets) {
    throw new Error(
      `${label ?? format}: rendering to ${format} needs EXT_color_buffer_float.`,
    );
  }
  const color = create_texture(gl, { size, format, label });
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    color.gpu.handle,
    0,
  );
  return {
    framebuffer,
    format,
    label,
    color,
    colors: [color],
    sampleCount: 1,
    clearColor: clear_color ?? [0, 0, 0, 1],
    get size() {
      return color.size;
    },
    get texelSize() {
      return color.size.map((extent) => 1 / extent);
    },
    resize(next) {
      allocate_texture(gl, color.gpu, next);
    },
    destroy() {
      gl.deleteFramebuffer(framebuffer);
      color.dispose();
    },
  };
};

export const target = (gpu, options) => {
  const { size, format = "rgba8unorm", label, clearColor } = options;
  if (options.depth || options.msaa || options.colors) {
    throw new Error(
      `${label ?? "target"}: the WebGL2 leg mirrors single-color targets only.`,
    );
  }
  return create_framebuffer_target(gpu, size, format, label, clearColor);
};

// One hidden backbuffer serves every surface of the context, and it only
// grows. Each change of its size makes the browser allocate a new backbuffer.
// With a backbuffer of the size of each surface, two surfaces of different
// sizes cost two allocations on each present. In a window on a 240 Hz
// display that held a page at 24 to 37 frames in a second.
const open_presenter = (gpu, canvas) => {
  const { gl } = gpu;
  const hidden = gpu.canvas;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The surface canvas already holds another context.");
  }
  return (surface) => {
    const [width, height] = surface.size;
    if (hidden.width < width) hidden.width = width;
    if (hidden.height < height) hidden.height = height;
    // The first row of a canvas is the top row of the backbuffer.
    const top = hidden.height;
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, surface.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      width,
      height,
      0,
      top,
      width,
      top - height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    context.globalCompositeOperation = "copy";
    context.drawImage(hidden, 0, 0, width, height, 0, 0, width, height);
  };
};

const surface_dpr = (dpr) => {
  const device = globalThis.devicePixelRatio || 1;
  if (Array.isArray(dpr)) return Math.min(Math.max(device, dpr[0]), dpr[1]);
  return dpr ?? device;
};

export const surface = (gpu, canvas, options = {}) => {
  if ([...gpu.surfaces.keys()].some((live) => live.canvas === canvas)) {
    throw new Error("This canvas already has a live surface.");
  }
  const initial = options.size ?? [canvas.width || 1, canvas.height || 1];
  const framebuffer_target = create_framebuffer_target(
    gpu,
    initial,
    "rgba8unorm",
    options.label,
    options.clearColor,
  );
  const present = open_presenter(gpu, canvas);
  const listeners = new Set();
  const resize_storage = framebuffer_target.resize;
  const sync_canvas = ([width, height]) => {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };

  const surface = Object.assign(framebuffer_target, {
    canvas,
    autoResize: options.autoResize ?? true,
    layoutBacked: false,
    dpr: surface_dpr(options.dpr),
    disposed: false,
    resize(next) {
      const current = surface.size;
      const width = Math.max(1, Math.round(next[0]));
      const height = Math.max(1, Math.round(next[1]));
      if (width === current[0] && height === current[1]) return;
      resize_storage([width, height]);
      sync_canvas([width, height]);
      for (const listener of listeners) {
        listener({ width, height, dpr: surface.dpr, surface });
      }
    },
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (surface.disposed) return;
      surface.disposed = true;
      gpu.surfaces.delete(surface);
      framebuffer_target.destroy();
    },
  });
  const apply_auto_resize = () => {
    surface.dpr = surface_dpr(options.dpr);
    surface.resize([
      canvas.clientWidth * surface.dpr,
      canvas.clientHeight * surface.dpr,
    ]);
  };
  sync_canvas(surface.size);
  gpu.surfaces.set(surface, { present, apply_auto_resize });
  return surface;
};

const open_pass = (gpu, target, clear) => {
  const { gl } = gpu;
  const [width, height] = target.size;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, width, height);
  if (clear === false) return;
  gl.colorMask(true, true, true, true);
  gl.clearBufferfv(
    gl.COLOR,
    0,
    clear_values(
      clear === undefined || clear === true ? target.clearColor : clear,
    ),
  );
};

const pass_options = (target_or_options) => {
  if (target_or_options.framebuffer) return { target: target_or_options };
  const extra = Object.keys(target_or_options).filter(
    (key) => key !== "target" && key !== "clear",
  );
  if (extra.length) {
    throw new Error(`The WebGL2 leg does not mirror pass options ${extra}.`);
  }
  return target_or_options;
};

export const frame = (gpu, body) => {
  if (typeof body !== "function") {
    throw new Error("The WebGL2 leg mirrors frame(gpu, callback) only.");
  }
  if (gpu.disposed) return undefined;
  for (const [live, { apply_auto_resize }] of gpu.surfaces) {
    if (live.autoResize) apply_auto_resize();
  }

  const touched = new Set();
  const current = {
    pass(target_or_options, drawable) {
      const { target: pass_target, clear } = pass_options(target_or_options);
      open_pass(gpu, pass_target, clear);
      if (gpu.surfaces.has(pass_target)) touched.add(pass_target);
      if (typeof drawable !== "function") {
        encode(drawable);
        return;
      }
      drawable({
        target: pass_target,
        draw: (next, call) => encode(next, call),
      });
    },
  };
  body(current);
  for (const live of touched) gpu.surfaces.get(live)?.present(live);
  return current;
};
