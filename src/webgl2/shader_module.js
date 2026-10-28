// Pairs a WGSL source with its naga GLSL. vgpu takes the result as a
// ShaderSource v1 and ignores `glsl`; the WebGL2 leg reads `glsl` and the
// WGSL bindings. A raw WGSL string becomes `{ version: 1, wgsl }`.
// It lives apart from ./index.js, so a WebGPU page does not load the leg.
export const shader_module = (wgsl_module, { frag, vert } = {}) => {
  if (typeof frag !== "string") {
    throw new TypeError("shader_module needs the generated GLSL fragment.");
  }
  const module =
    typeof wgsl_module === "string"
      ? { version: 1, wgsl: wgsl_module }
      : wgsl_module;
  return { ...module, glsl: { frag, vert } };
};
