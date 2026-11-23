import { scene_for } from "./index.js";
import { create_gpu_input, create_input } from "./inputs.js";
import { composition_gpu, dispose_input } from "./composition_gpu.js";
import { composition_plan, scaled_size } from "./passes.js";
import { draw_composition } from "./composition_frame.js";
import { join_gpu_page } from "../gpu/lifecycle.js";
import { accepted_levels, LEVELS } from "../gpu/budget.js";

const active_outputs = new WeakSet();

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
  { backend = "auto", open_gpu, max_pixels = 1048576, share = 1, levels, wants_frame } = {},
) {
  if (!["auto", "webgpu", "webgl2"].includes(backend))
    throw new RangeError("Unknown scene backend.");
  if (!Number.isSafeInteger(max_pixels) || max_pixels < 1)
    throw new RangeError("The scene pixel budget must be positive.");
  if (!Number.isFinite(share) || share <= 0)
    throw new RangeError("A composition share must be positive.");
  if (wants_frame !== undefined && typeof wants_frame !== "function")
    throw new TypeError("wants_frame must be a function.");
  const accepted = accepted_levels(levels);
  if (active_outputs.has(canvas))
    throw new Error("This canvas already has a compositor.");
  const scene = scene_for(canvas.ownerDocument);
  const output = scene.layer(canvas, { surface: true });
  active_outputs.add(canvas);
  let resources = null;
  let rendering = false;
  let signature = null;
  let pending = null, current_request = null;
  let interrupt = null;
  let rebuild = false, paused = false;
  let dimensions = {}, last_time;
  const client = {
    target: canvas, share, levels: accepted, handle: {}, continues: false,
    get requested() { return rebuild || pending !== null; },
    wants_frame(now) {
      if (disposed || output.disposed) return false;
      try {
        this.continues = !paused && Boolean(wants_frame?.(now));
      } catch (error) {
        paused = true;
        this.continues = false;
        console.error("[Folly scene] Frame request failed.", error);
      }
      return this.requested || this.continues;
    },
    release(reason) {
      interrupt?.(reason);
      pending?.reject(reason);
      current_request?.reject(reason);
      pending = null;
      rebuild = true;
      signature = null;
      client.handle = {};
      const previous = resources;
      resources = null;
      previous?.dispose();
    },
    restart() { paused = false; rebuild = true; },
    draw,
  };
  const { lifecycle, frame, budget, leave } = join_gpu_page(canvas.ownerDocument, { backend, open_gpu }, client, "composition");
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
    attempt(() => client.release(new Error("The compositor is disposed.")));
    leave();
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
    if (wants_frame) frame.schedule();
    return input;
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    const error = new Error("The compositor is disposed.");
    interrupt?.(error);
    pending?.reject(error);
    pending = null;
    if (!rendering) release();
  }
  try {
    const renderer = await lifecycle.boot();
    require_live();
    if (!renderer) throw new Error("The page GPU is unavailable.");
    if (backend !== "auto" && renderer.backend !== backend)
      throw new Error(`The page uses ${renderer.backend}, not ${backend}.`);
    resources = composition_gpu(canvas, renderer.opened);
  } catch (error) {
    dispose();
    throw error;
  }
  output.own(dispose);
  if (wants_frame) frame.schedule();
  return {
    get backend() { return lifecycle.renderer?.backend ?? null; },
    source: (layer, image, options) => add("source", layer, image, options),
    backdrop: (layer, options) => add("backdrop", layer, null, options),
    field: (layer, options) => add("field", layer, null, options),
    plane: (layer, options) => add("plane", layer, null, options),
    get stats() {
      return { ...counts };
    },
    dispose,
    async render({ width, height, pixel_ratio = 1, now } = {}) {
      require_live();
      if (pending || current_request) throw new Error("A composition render is already pending.");
      if (lifecycle.failed) throw new Error("The page GPU is unavailable.");
      if (![width ?? 1, height ?? 1, pixel_ratio].every((n) => Number.isFinite(n) && n > 0))
        throw new RangeError("Composition dimensions and pixel ratio must be positive.");
      dimensions = { width, height, pixel_ratio };
      paused = false;
      pending = { ...Promise.withResolvers(), now };
      frame.schedule();
      return pending.promise;
    },
  };

  // A host build can outlive the device. Stop waiting at loss or disposal;
  // the operation still owns any late result and must release it below.
  function while_owned(start) {
    return new Promise((resolve, reject) => {
      interrupt = reject;
      start().then(resolve, reject);
    });
  }

  async function draw(frame_time, frame_ms, quality) {
    current_request = pending;
    pending = null;
    const now = current_request?.now ?? (rebuild && !client.continues ? last_time : undefined) ?? frame_time;
    rebuild = false;
    const renderer = lifecycle.renderer;
    rendering = true;
    try {
      resources ??= composition_gpu(canvas, renderer.opened);
      const current = resources;
      const {
        width = canvas.clientWidth || canvas.width,
        height = canvas.clientHeight || canvas.height,
        pixel_ratio = 1,
      } = dimensions;
      const full_density = Math.min(pixel_ratio, Math.sqrt(max_pixels / (width * height)));
      const density = full_density * quality.scale;
      const limit = renderer.gpu.device.limits?.maxTextureDimension2D ?? 8192;
      const size = scaled_size(width, height, density, max_pixels, limit);
      const states = current.prepared;
      const plan = composition_plan(layout(entries), states);
      const next_signature = plan.dynamic ? null : JSON.stringify([
        membership, width, height, ...size,
        ...plan.ordered.map(({ index, order, opacity, input }) => [index, order, opacity, input.revision]),
      ]);
      if (!plan.dynamic && next_signature === signature) {
        current_request?.resolve(false);
        return false;
      }
      for (const input of plan.build) {
        require_live();
        if (input.disposed) throw new Error("A composition input was disposed before build.");
        await while_owned(async () => {
          const prepared = await current.prepare(input);
          if (input.disposed || disposed || current !== resources) {
            dispose_input(prepared);
            throw new Error("Composition ownership changed during preparation.");
          }
          states.set(input, prepared);
        });
      }
      for (const { input } of plan.ordered) {
        require_live();
        const state = states.get(input);
        if (!state || input.disposed)
          throw new Error("A composition input changed during preparation.");
        if (input.kind === "source" && state.revision !== input.image_revision) {
          const revision = input.image_revision;
          await while_owned(() => current.upload(state, input));
          state.revision = revision;
          counts.uploads++;
        }
      }
      current.assert_live();
      require_live();
      current.resize(plan, size, max_pixels, limit);
      budget.drawn(client, frame_time, frame_ms, width * height * full_density ** 2, quality.scale);
      counts.passes += draw_composition(current, plan, size, density, {
        now, level: LEVELS.indexOf(quality), renderer, item: client, frame_time,
      });
      current.present(Math.max(1, Math.floor(width * full_density)), Math.max(1, Math.floor(height * full_density)));
      counts.frames++;
      signature = next_signature;
      last_time = now;
      current_request?.resolve(true);
      return true;
    } catch (error) {
      // A bad application draw does not mean the shared device was lost.
      if (current_request) current_request.reject(error);
      else if (!disposed && resources) console.error("[Folly scene] Draw failed.", error);
      if (renderer === lifecycle.renderer) paused = true;
      return false;
    } finally {
      interrupt = null;
      current_request = null;
      rendering = false;
      for (const state of retired.splice(0)) dispose_input(state);
      if (disposed) release();
    }
  }
}
