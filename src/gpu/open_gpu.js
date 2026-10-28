const LEGS = {
  webgpu: () => import("vgpu"),
  webgl2: () => import("../webgl2/index.js"),
};

// Opens the asked leg: vgpu on WebGPU, or the WebGL2 leg. Both modules take
// the same calls. A host page may pass its own `open_gpu(kind)` with the same
// result shape, { kind, api, gpu }. It may answer with another kind, for
// example when the page forces WebGL2.
export async function open_gpu(kind, options) {
  if (kind === "webgpu" && !globalThis.navigator?.gpu) {
    throw new Error("WebGPU is unavailable");
  }
  const leg = LEGS[kind];
  if (!leg) throw new RangeError(`Unknown GPU backend "${kind}"`);
  const api = await leg();
  return { kind, api, gpu: await api.init(options) };
}
