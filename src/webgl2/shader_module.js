// Pairs a prepared vgpu shader with its naga GLSL. vgpu 0.6 takes only a
// prepared ShaderSource v2 (a .wgsl import through the vgpu loader, or
// prepareShader() output), deeply frozen, so shader_module() returns the
// shader untouched and keeps the GLSL beside it; the WebGL2 leg reads it
// through shader_glsl(). It lives apart from ./index.js, so a WebGPU page
// does not load the leg.
const glsl_of = new WeakMap();

export const shader_module = (shader, { frag, vert } = {}) => {
  if (shader?.version !== 2 || typeof shader.wgsl !== "string") {
    throw new TypeError(
      "shader_module needs a prepared vgpu shader (ShaderSource v2): a .wgsl import through the vgpu loader, or prepareShader() from @vgpu/wgsl/prepare.",
    );
  }
  if (typeof frag !== "string") {
    throw new TypeError("shader_module needs the generated GLSL fragment.");
  }
  glsl_of.set(shader, { frag, vert });
  return shader;
};

// The GLSL that shader_module() paired with `shader`, or undefined.
export const shader_glsl = (shader) => glsl_of.get(shader);
