// WebGL2 leg of the vgpu subset that Folly and the site use. The module
// namespace mirrors `import("vgpu")`: init, surface, target, effect, draw,
// sampler, frame, and on the gpu: device.createTexture, error scopes,
// gpu.queue.writeTexture, gpu.queue.copyExternalImageToTexture, gpu.lost,
// onError, settled, dispose. Anything outside that subset throws.
//
// Each effect writes its shader once in WGSL. Naga converts the WGSL to GLSL,
// and shader_module() hands the leg both, so one source serves both backends.
//
// Each file carries its own facts: context.js owns the gpu (one hidden
// context, errors, loss, dispose); textures.js owns textures, samplers and
// DataTexture (the StorageBuffer stand-in); uniforms.js owns std140
// reflection and packing; programs.js owns GLSL programs, effects, draws and
// row orientation; surfaces.js owns targets, surfaces, frame and present.

export { init } from "./context.js";
export { sampler, DataTexture } from "./textures.js";
export { effect, draw } from "./programs.js";
export { target, surface, frame } from "./surfaces.js";
export { shader_module } from "./shader_module.js";
