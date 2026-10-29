const LEGS = {
  webgpu: () => import("vgpu"),
  webgl2: () => import("../webgl2/index.js"),
};

// The vgpu init options for a request. `timing` asks for the
// "timestamp-query" feature, only when the adapter has it: vgpu fails init on
// a required feature the adapter lacks.
export async function webgpu_init_options({ timing = false } = {}) {
  if (!timing) return undefined;
  const adapter = await globalThis.navigator?.gpu?.requestAdapter?.();
  return adapter?.features?.has("timestamp-query")
    ? { requiredFeatures: ["timestamp-query"] }
    : undefined;
}

// Opens the asked leg: vgpu on WebGPU, or the WebGL2 leg. Both modules take
// the same calls. A host page may pass its own `open_gpu(kind, request)` with
// the same result shape, { kind, api, gpu }. It may answer with another kind,
// for example when the page forces WebGL2. `request` is { timing }.
export async function open_gpu(kind, request) {
  if (kind === "webgpu" && !globalThis.navigator?.gpu) {
    throw new Error("WebGPU is unavailable");
  }
  const leg = LEGS[kind];
  if (!leg) throw new RangeError(`Unknown GPU backend "${kind}"`);
  const api = await leg();
  const options =
    kind === "webgpu" ? await webgpu_init_options(request) : undefined;
  return { kind, api, gpu: await api.init(options) };
}
