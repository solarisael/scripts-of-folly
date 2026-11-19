import { SCENE_WGSL } from "./wgsl.js";
import { FRAG, VERT } from "./glsl.generated.js";
import { shader_module } from "../webgl2/shader_module.js";

const shader = shader_module(SCENE_WGSL, { frag: FRAG, vert: VERT });

export function composition_gpu(canvas, { api, gpu, kind }) {
  const owned = [];
  let disposed = false;
  let failure = null;
  const keep = (value) => {
    owned.push(value);
    return value;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const resource of owned.reverse()) {
      try {
        (resource.dispose ?? resource.destroy).call(resource);
      } catch (error) {
        errors.push(error);
      }
    }
    owned.length = 0;
    gpu.dispose();
    if (errors.length)
      throw new AggregateError(errors, "Composition resource cleanup failed.");
  };
  try {
    const unsubscribe = gpu.onError((error) => {
      failure = error;
    });
    keep({ dispose: unsubscribe });
    gpu.gpu.lost.then((info) => {
      if (!disposed)
        failure = new Error(info.message || "Composition device lost.");
    });
    const format =
      kind === "webgpu"
        ? navigator.gpu.getPreferredCanvasFormat()
        : "rgba8unorm";
    const surface = keep(
      api.surface(gpu, canvas, {
        autoResize: false,
        size: [1, 1],
        dpr: 1,
        format,
        alphaMode: "premultiplied",
      }),
    );
    const target = (label) =>
      keep(
        api.target(gpu, {
          size: [1, 1],
          format: "rgba8unorm",
          clearColor: [0, 0, 0, 0],
          label,
        }),
      );
    const fields = [target("scene-a"), target("scene-b")];
    const scratch = target("scene-blur-horizontal");
    const sampler = api.sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    if (kind === "webgl2")
      keep({ dispose: () => gpu.gl.deleteSampler(sampler.handle) });
    const blank = keep(
      gpu.device.createTexture({
        kind: "2d",
        size: [1, 1],
        format: "rgba8unorm",
        usage: ["texture_binding", "copy_dst"],
      }),
    );
    gpu.gpu.queue.writeTexture(
      { texture: blank.gpu },
      new Uint8Array(4),
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1 },
    );
    const make_effect = () =>
      api.effect(gpu, shader, {
        set: {
          plane: {
            frame: [1, 1, 3, 0],
            rect: [0, 0, 1, 1],
            effect: [1, 0, 0, 0],
          },
          backdrop: blank,
          image: blank,
          image_sampler: sampler,
        },
      });
    const present = make_effect();
    // Native effects belong to the device; the WebGL2 leg releases programs here.
    keep({ dispose: () => present.dispose?.() });
    return {
      kind,
      api,
      gpu,
      surface,
      fields,
      scratch,
      blank,
      present,
      dispose,
      assert_live() {
        if (disposed) throw new Error("The compositor is disposed.");
        if (failure) throw failure;
      },
      async prepare(input) {
        const effects = [make_effect()];
        if (input.blur) effects.push(make_effect());
        try {
          await Promise.all(effects.map((effect) => effect.compile(fields[0])));
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
      resize(size) {
        for (const field of [...fields, scratch, surface]) {
          if (field.size[0] !== size[0] || field.size[1] !== size[1])
            field.resize(size);
        }
      },
      async ready() {
        await present.compile({ colors: [format] });
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
  state.texture?.dispose();
  // vgpu releases native effect uniforms and caches with the device.
  for (const effect of state.effects) effect.dispose?.();
}
