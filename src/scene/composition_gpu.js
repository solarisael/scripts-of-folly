import scene_shader from "./wgsl.generated.js";
import { FRAG, VERT } from "./glsl.generated.js";
import { shader_module } from "../webgl2/shader_module.js";
import { scaled_size } from "./passes.js";

const shader = shader_module(scene_shader, { frag: FRAG, vert: VERT });

// Blend is pipeline state on both backends, not a render-pass option.
function plane_api(api, mode) {
  const blend = { replace: undefined, over: "premultiplied", add: "additive" }[mode];
  const output = (options) => {
    if (options?.colors)
      throw new Error("A GPU plane has one color attachment and sets its own blend.");
    return { ...options, blend };
  };
  return Object.create(api, {
    effect: { value: (gpu, shader, options) => api.effect(gpu, shader, output(options)) },
    draw: { value: (gpu, options) => api.draw(gpu, output(options)) },
  });
}

function resize(target, size) {
  const current = target.size;
  if (current[0] !== size[0] || current[1] !== size[1]) target.resize(size);
}

export function composition_gpu(canvas, { api, gpu, kind }) {
  const prepared = new Map();
  const blends = new Map();
  const owned = [];
  let disposed = false;
  // The caller owns the output node. A WebGPU context on that node would
  // lock out the WebGL2 presenter after loss. Transfer the bitmap instead.
  const bitmap = typeof OffscreenCanvas === "function" && canvas.getContext("bitmaprenderer");
  const copy = !bitmap && canvas.getContext("2d");
  if (!bitmap && !copy) throw new Error("The composition output already holds another context.");
  const drawing = bitmap ? new OffscreenCanvas(1, 1) : canvas.ownerDocument.createElement("canvas");
  const keep = (value) => {
    owned.push(value);
    return value;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors = [];
    // Resetting the canvas width does not evict a transferred bitmap.
    try {
      if (bitmap) bitmap.transferFromImageBitmap(null);
      else copy.clearRect(0, 0, canvas.width, canvas.height);
    } catch (error) {
      errors.push(error);
    }
    for (const state of prepared.values()) {
      try {
        dispose_input(state);
      } catch (error) {
        errors.push(error);
      }
    }
    prepared.clear();
    for (const resource of owned.reverse()) {
      try {
        (resource.dispose ?? resource.destroy).call(resource);
      } catch (error) {
        errors.push(error);
      }
    }
    owned.length = 0;
    if (errors.length)
      throw new AggregateError(errors, "Composition resource cleanup failed.");
  };
  try {
    const format =
      kind === "webgpu"
        ? navigator.gpu.getPreferredCanvasFormat()
        : "rgba8unorm";
    const surface = keep(
      api.surface(gpu, drawing, {
        autoResize: false,
        size: [1, 1],
        dpr: 1,
        format,
        clearColor: [0, 0, 0, 0],
        alphaMode: "premultiplied",
      }),
    );
    const target = (size, format, label) =>
      api.target(gpu, { size, format, label, clearColor: [0, 0, 0, 0] });
    let images;
    function image_resources() {
      if (images) return images;
      const pair = ["scene-a", "scene-b"].map((label) =>
        keep(target([1, 1], "rgba8unorm", label)),
      );
      const sampler = api.sampler(gpu, {
        minFilter: "linear",
        magFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      if (kind === "webgl2")
        keep({ dispose: () => gpu.gl.deleteSampler(sampler.handle) });
      const blank = keep(gpu.device.createTexture({
        kind: "2d", size: [1, 1], format: "rgba8unorm",
        usage: ["texture_binding", "copy_dst"],
      }));
      gpu.gpu.queue.writeTexture(
        { texture: blank.gpu }, new Uint8Array(4),
        { bytesPerRow: 4, rowsPerImage: 1 }, { width: 1, height: 1 },
      );
      const make_effect = () => api.effect(gpu, shader, {
        set: {
          plane: { frame: [1, 1, 3, 0], rect: [0, 0, 1, 1], effect: [1, 0, 0, 0] },
          backdrop: blank, image: blank, image_sampler: sampler,
        },
      });
      const present = make_effect();
      keep({ dispose: () => present.dispose?.() });
      images = { pair, make_effect, present, ready: present.compile({ colors: [format] }) };
      return images;
    }
    return {
      surface,
      prepared,
      present(width, height) {
        // A budget step changes the GPU target, never the CSS layout of
        // an output whose intrinsic size comes from its canvas attributes.
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        if (bitmap) bitmap.transferFromImageBitmap(drawing.transferToImageBitmap());
        else { copy.globalCompositeOperation = "copy"; copy.drawImage(drawing, 0, 0, width, height); }
      },
      get images() { return images; },
      dispose,
      assert_live() {
        if (disposed) throw new Error("The compositor is disposed.");
      },
      async prepare(input) {
        if (input.kind === "field" || input.kind === "plane") {
          if (input.kind === "plane" && !blends.has(input.blend))
            blends.set(input.blend, plane_api(api, input.blend));
          const build_api = input.kind === "field" ? api : blends.get(input.blend);
          return { built: await input.build(gpu, build_api), target: null };
        }
        const { make_effect, pair, ready } = image_resources();
        await ready;
        const effects = [make_effect()];
        if (input.blur) effects.push(make_effect());
        try {
          await Promise.all(effects.map((effect) => effect.compile(pair[0])));
        } catch (error) {
          effects.forEach((effect) => effect.dispose?.());
          throw error;
        }
        return { effects, texture: null, revision: 0 };
      },
      async upload(state, input) {
        const source = input.source;
        const width = source.videoWidth || source.naturalWidth || source.width;
        const height =
          source.videoHeight || source.naturalHeight || source.height;
        if (
          !state.texture ||
          state.texture.size[0] !== width ||
          state.texture.size[1] !== height
        ) {
          const next = gpu.device.createTexture({
            kind: "2d",
            size: [width, height],
            format: "rgba8unorm",
            usage: ["texture_binding", "copy_dst", "render_attachment"],
          });
          state.texture?.dispose();
          state.texture = next;
        }
        gpu.gpu.pushErrorScope?.("validation");
        try {
          gpu.gpu.queue.copyExternalImageToTexture(
            { source, flipY: false },
            {
              texture: state.texture.gpu,
              premultipliedAlpha: true,
              colorSpace: "srgb",
            },
            { width, height, depthOrArrayLayers: 1 },
          );
        } catch (error) {
          await gpu.gpu.popErrorScope?.();
          throw error;
        }
        const error = await gpu.gpu.popErrorScope?.();
        if (error) throw error;
      },
      resize(plan, size, max_pixels, limit) {
        resize(surface, size);
        for (const { input } of plan.fields) {
          const extent = scaled_size(...size, input.scale, max_pixels, limit);
          const state = prepared.get(input);
          if (state.target) resize(state.target, extent);
          else state.target = target(extent, input.format, "scene-field");
        }
        if (plan.groups.length === 1) return;
        for (const buffer of images.pair) resize(buffer, size);
        if (plan.groups.some(({ base }) => base?.input.blur && base.input.effect === "blur")) {
          images.scratch ??= keep(target(size, "rgba8unorm", "scene-blur-horizontal"));
          resize(images.scratch, size);
        }
      },
    };
  } catch (error) {
    try {
      dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Composition initialization failed.",
      );
    }
    throw error;
  }
}

export function dispose_input(state) {
  try {
    state.built?.dispose?.();
  } finally {
    state.target?.destroy();
    state.texture?.dispose();
    for (const effect of state.effects ?? []) effect.dispose?.();
  }
}
