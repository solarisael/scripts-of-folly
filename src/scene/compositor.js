import { scene_for } from "./index.js";
import { create_gpu_input, create_input } from "./inputs.js";
import { composition_gpu, dispose_input } from "./composition_gpu.js";
import { composition_plan, scaled_size } from "./passes.js";
import { draw_composition } from "./composition_frame.js";
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
    });
}

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
  let resources = null;
  let actual_backend;
  let rendering = false;
  let signature = null;
  let cleanup_error;
  function drop_device() {
    const previous = resources;
    resources = null;
    signature = null;
    previous?.dispose();
  }
  async function connect(kind) {
    const opened = await open_backend(kind, open_gpu);
    resources = composition_gpu(canvas, opened, () => {
      // An async build still owns its result until the pending render exits.
      if (rendering) return;
      try {
        drop_device();
      } catch (error) {
        cleanup_error = error;
      }
    });
    actual_backend = opened.kind;
  }
  try {
    await connect(backend);
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
  const retired = [];
  let disposed = false;
  let released = false;
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
    attempt(drop_device);
    if (cleanup_error) errors.push(cleanup_error);
    output.disown(dispose);
    if (errors.length)
      throw new AggregateError(errors, "Compositor cleanup failed.");
  };
  const remove = (input) => {
    entries.delete(input);
    membership++;
    const state = resources?.prepared.get(input);
    resources?.prepared.delete(input);
    if (!state) return;
    if (rendering) retired.push(state);
    else dispose_input(state);
  };
  const require_live = () => {
    if (disposed || output.disposed)
      throw new Error("The compositor is disposed.");
    if (cleanup_error) throw cleanup_error;
    resources?.assert_live();
  };
  const add = (kind, layer, source, options = {}) => {
    require_live();
    if (layer.disposed) throw new Error("Cannot compose a disposed layer.");
    if (layer.element === canvas)
      throw new Error("The output layer cannot also be an input.");
    if (layer.element.ownerDocument !== canvas.ownerDocument)
      throw new Error("Composition inputs must share the output document.");
    if (source === canvas)
      throw new Error("A compositor cannot sample its own output.");
    const input = kind === "field" || kind === "plane"
      ? create_gpu_input(kind, layer, options, entries, remove)
      : create_input(layer, source, options, remove, canvas);
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
    get backend() { return actual_backend; },
    source: (layer, image, options) => add("source", layer, image, options),
    backdrop: (layer, options) => add("backdrop", layer, null, options),
    field: (layer, options) => add("field", layer, null, options),
    plane: (layer, options) => add("plane", layer, null, options),
    get stats() {
      return { ...counts };
    },
    dispose,
    async render({
      width = canvas.clientWidth || canvas.width,
      height = canvas.clientHeight || canvas.height,
      pixel_ratio = 1,
      now = performance.now(),
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
        // A canvas keeps its context type. Reopen the selected leg, not "auto".
        if (!resources) await connect(actual_backend);
        require_live();
        const density = Math.min(
          pixel_ratio,
          Math.sqrt(max_pixels / (width * height)),
        );
        const limit = resources.gpu.device.limits?.maxTextureDimension2D ?? 8192;
        const size = scaled_size(width, height, density, max_pixels, limit);
        const states = resources.prepared;
        const plan = composition_plan(layout(entries), states);
        const next_signature = plan.dynamic ? null : JSON.stringify([
          membership,
          width,
          height,
          ...size,
          ...plan.ordered.map((item) => [
            item.index,
            item.order,
            item.opacity,
            item.input.revision,
          ]),
        ]);
        if (!plan.dynamic && next_signature === signature) return false;
        for (const input of plan.build) {
          require_live();
          if (input.disposed) throw new Error("A composition input was disposed before build.");
          const prepared = await resources.prepare(input);
          if (input.disposed || disposed) {
            dispose_input(prepared);
            throw new Error("Composition ownership changed during preparation.");
          }
          states.set(input, prepared);
        }
        for (const { input } of plan.ordered) {
          require_live();
          const state = states.get(input);
          if (!state || input.disposed)
            throw new Error("A composition input changed during preparation.");
          if (input.kind === "source" && state.revision !== input.image_revision) {
            const revision = input.image_revision;
            await resources.upload(state, input);
            state.revision = revision;
            counts.uploads++;
          }
        }
        require_live();
        resources.resize(plan, size, max_pixels, limit);
        counts.passes += draw_composition(resources, plan, size, density, now);
        resources.assert_live();
        counts.frames++;
        signature = next_signature;
        return true;
      } finally {
        rendering = false;
        for (const state of retired.splice(0)) dispose_input(state);
        if (disposed) release();
        else if (resources?.lost) drop_device();
      }
    },
  };
}
