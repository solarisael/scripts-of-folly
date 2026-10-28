// The gpu of the WebGL2 leg: its context, errors, loss and dispose.
//
// One hidden WebGL2 context per gpu owns every program, texture and target,
// the way one GPUDevice does, so compile() stays context-free and a target
// pass may run before any surface exists.

import {
  copy_external_image,
  create_texture,
  write_texture,
} from "./textures.js";

export const init = async () => {
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(1, 1)
      : document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) throw new Error("WebGL2 is unavailable.");

  const listeners = new Set();
  let resolve_lost;
  const lost = new Promise((resolve) => {
    resolve_lost = resolve;
  });
  canvas.addEventListener("webglcontextlost", () =>
    resolve_lost({ reason: "unknown", message: "WebGL2 context lost." }),
  );
  gl.bindVertexArray(gl.createVertexArray());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  // Mirrors pushErrorScope/popErrorScope: the scope opens with a clear error
  // flag, and the pop returns the first WebGL2 error inside it, or null.
  const read_error = () => {
    const code = gl.getError();
    return code === gl.NO_ERROR || gl.isContextLost()
      ? null
      : new Error(`WebGL2 error 0x${code.toString(16)}.`);
  };
  const push_error_scope = () => {
    const earlier = read_error();
    if (earlier) gpu.report(earlier);
  };
  const pop_error_scope = () => read_error();

  const gpu = {
    kind: "webgl2",
    canvas,
    gl,
    float_targets: Boolean(gl.getExtension("EXT_color_buffer_float")),
    float_linear: Boolean(gl.getExtension("OES_texture_float_linear")),
    programs: new Map(),
    surfaces: new Map(),
    disposed: false,
    device: {
      createTexture: (descriptor) => create_texture(gl, descriptor),
      pushErrorScope: () => push_error_scope(),
      popErrorScope: async () => pop_error_scope(),
    },
    gpu: {
      lost,
      pushErrorScope: () => push_error_scope(),
      popErrorScope: async () => pop_error_scope(),
      queue: {
        writeTexture: (destination, data, layout, size) =>
          write_texture(gl, destination, data, layout, size),
        copyExternalImageToTexture: (source, destination, size) =>
          copy_external_image(gl, source, destination, size),
      },
    },
    report(error) {
      for (const listener of listeners) listener(error);
    },
    onError(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async settled() {
      const code = gl.getError();
      if (code !== gl.NO_ERROR && !gl.isContextLost()) {
        gpu.report(new Error(`WebGL2 error 0x${code.toString(16)}.`));
      }
    },
    dispose() {
      if (gpu.disposed) return;
      gpu.disposed = true;
      for (const surface of [...gpu.surfaces.keys()]) surface.dispose();
      resolve_lost({ reason: "destroyed", message: "WebGL2 gpu disposed." });
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return gpu;
};
