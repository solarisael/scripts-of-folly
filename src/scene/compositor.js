import { scene_for } from "./index.js";
import { create_input } from "./inputs.js";
import { composition_gpu, dispose_input } from "./composition_gpu.js";
import { open_gpu as default_open } from "../gpu/open_gpu.js";

const active_outputs = new WeakSet();

async function open_backend(backend, open_gpu) {
  if (backend !== "auto") return open_gpu(backend);
  try {
    return await open_gpu("webgpu");
  } catch (error) {
    console.info("[Folly scene] WebGPU unavailable; trying WebGL2.", error);
    return open_gpu("webgl2");
  }
}

function layout(entries) {
  return [...entries]
    .filter((input) => !input.disposed)
    .map((input, index) => {
      const style = input.layer.element.style;
      const order = Number.parseFloat(style.zIndex) || 0;
      const opacity = style.opacity === "" ? 1 : Number(style.opacity);
      return { input, index, order, opacity };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index);
}

function plane_values(size, rect, mode, radius, opacity, direction) {
  return {
    frame: [size[0], size[1], mode, radius],
    rect,
    effect: [opacity, ...direction, 0],
  };
}

// Inputs are explicit images. This renderer never captures arbitrary page DOM.
export async function create_compositor(
  canvas,
  { backend = "auto", open_gpu = default_open, max_pixels = 1048576 } = {},
) {
  if (!["auto", "webgpu", "webgl2"].includes(backend))
    throw new RangeError("Unknown scene backend.");
  if (!Number.isSafeInteger(max_pixels) || max_pixels < 1)
    throw new RangeError("The scene pixel budget must be positive.");
  if (active_outputs.has(canvas))
    throw new Error("This canvas already has a compositor.");
  const scene = scene_for(canvas.ownerDocument);
  const output = scene.layer(canvas, { surface: true });
  active_outputs.add(canvas);
  let resources;
  try {
    resources = composition_gpu(canvas, await open_backend(backend, open_gpu));
    await resources.ready();
    if (output.disposed)
      throw new Error("The output layer was disposed during initialization.");
  } catch (error) {
    active_outputs.delete(canvas);
    try {
      resources?.dispose();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Compositor initialization failed.",
      );
    }
    throw error;
  }
  const entries = new Set();
  const states = new Map();
  const retired = [];
  let disposed = false;
  let rendering = false;
  let released = false;
  let signature = null;
  let membership = 0;
  const counts = { frames: 0, uploads: 0, passes: 0 };
  const release = () => {
    if (released) return;
    released = true;
    active_outputs.delete(canvas);
    const errors = [];
    const attempt = (callback) => {
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const input of [...entries]) attempt(() => input.dispose());
    for (const state of retired.splice(0)) attempt(() => dispose_input(state));
    attempt(() => resources.dispose());
    output.disown(dispose);
    if (errors.length)
      throw new AggregateError(errors, "Compositor cleanup failed.");
  };
  const remove = (input) => {
    entries.delete(input);
    membership++;
    const state = states.get(input);
    states.delete(input);
    if (!state) return;
    if (rendering) retired.push(state);
    else dispose_input(state);
  };
  const require_live = () => {
    if (disposed || output.disposed)
      throw new Error("The compositor is disposed.");
    resources.assert_live();
  };
  const add = (layer, source, options) => {
    require_live();
    if (layer.element === canvas)
      throw new Error("The output layer cannot also be an input.");
    if (layer.element.ownerDocument !== canvas.ownerDocument)
      throw new Error("Composition inputs must share the output document.");
    if (source === canvas)
      throw new Error("A compositor cannot sample its own output.");
    const input = create_input(layer, source, options, remove, canvas);
    entries.add(input);
    membership++;
    return input;
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (!rendering) release();
  }
  output.own(dispose);
  return {
    backend: resources.kind,
    source: (layer, image, options = {}) => add(layer, image, options),
    backdrop: (layer, options) => add(layer, null, options),
    get stats() {
      return { ...counts };
    },
    dispose,
    async render({
      width = canvas.clientWidth || canvas.width,
      height = canvas.clientHeight || canvas.height,
      pixel_ratio = 1,
    } = {}) {
      require_live();
      if (rendering)
        throw new Error("A composition render is already pending.");
      if (
        ![width, height, pixel_ratio].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        throw new RangeError(
          "Composition dimensions and pixel ratio must be positive.",
        );
      rendering = true;
      try {
        const density = Math.min(
          pixel_ratio,
          Math.sqrt(max_pixels / (width * height)),
        );
        const size = [
          Math.max(1, Math.floor(width * density)),
          Math.max(1, Math.floor(height * density)),
        ];
        const limit =
          resources.gpu.device.limits?.maxTextureDimension2D ?? 8192;
        if (
          size[0] * size[1] > max_pixels ||
          size.some((value) => value > limit)
        )
          throw new RangeError(
            "Composition dimensions exceed the GPU or pixel budget.",
          );
        const ordered = layout(entries);
        const next_signature = JSON.stringify([
          membership,
          width,
          height,
          ...size,
          ...ordered.map((item) => [
            item.index,
            item.order,
            item.opacity,
            item.input.revision,
          ]),
        ]);
        if (next_signature === signature) return false;
        resources.resize(size);
        for (const { input } of ordered) {
          if (!states.has(input)) {
            const prepared = await resources.prepare(input);
            if (input.disposed || disposed) {
              dispose_input(prepared);
              throw new Error(
                "Composition ownership changed during preparation.",
              );
            }
            states.set(input, prepared);
          }
          require_live();
          const state = states.get(input);
          if (!state || input.disposed)
            throw new Error("A composition input changed during preparation.");
          if (!input.blur && state.revision !== input.image_revision) {
            const revision = input.image_revision;
            await resources.upload(state, input);
            state.revision = revision;
            counts.uploads++;
          }
        }
        require_live();
        resources.api.frame(resources.gpu, (frame) => {
          let current = 0;
          frame.pass(resources.fields[current], () => {});
          counts.passes++;
          for (const { input, opacity } of ordered) {
            if (input.disposed)
              throw new Error(
                "A composition input was disposed before submission.",
              );
            const state = states.get(input);
            const background = resources.fields[current];
            const next = resources.fields[1 - current];
            const rect = input.rect.map((value) => value * density);
            if (input.blur && input.effect === "blur") {
              state.effects[0].set({
                plane: plane_values(
                  size,
                  rect,
                  1,
                  input.radius * density,
                  opacity,
                  [1, 0],
                ),
                backdrop: background.color,
              });
              frame.pass(resources.scratch, state.effects[0]);
              state.effects[1].set({
                plane: plane_values(
                  size,
                  rect,
                  2,
                  input.radius * density,
                  opacity,
                  [0, 1],
                ),
                backdrop: resources.scratch.color,
                image: background.color,
              });
              frame.pass(next, state.effects[1]);
              counts.passes += 2;
            } else if (input.blur) {
              state.effects[0].set({
                plane: plane_values(
                  size,
                  rect,
                  input.effect === "refraction" ? 4 : 5,
                  input.radius * density,
                  opacity,
                  [0, 0],
                ),
                backdrop: background.color,
              });
              frame.pass(next, state.effects[0]);
              counts.passes++;
            } else {
              state.effects[0].set({
                plane: plane_values(
                  size,
                  rect,
                  input.source_effect === "neon" ? 6 : 0,
                  0,
                  opacity,
                  [0, 0],
                ),
                backdrop: background.color,
                image: state.texture,
              });
              frame.pass(next, state.effects[0]);
              counts.passes++;
            }
            current = 1 - current;
          }
          resources.present.set({
            plane: plane_values(size, [0, 0, ...size], 3, 0, 1, [0, 0]),
            backdrop: resources.fields[current].color,
          });
          frame.pass(resources.surface, resources.present);
          counts.passes++;
        });
        resources.assert_live();
        counts.frames++;
        signature = next_signature;
        return true;
      } finally {
        rendering = false;
        for (const state of retired.splice(0)) dispose_input(state);
        if (disposed) release();
      }
    },
  };
}
