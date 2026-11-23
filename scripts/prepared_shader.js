// The text of a generated module whose default export is the prepared vgpu
// shader (ShaderSource v2) of `wgsl`: vgpu 0.6 draws only prepared shaders.
// prepareShader() runs here, at build time, so a page never loads the WGSL
// parser. The export is deeply frozen, like the modules of the vgpu loaders,
// so vgpu validates it once and reuses the result for every draw.
// `path` names the shader in diagnostics and in the reflection; keep it
// relative to the repository, so the output is the same on every machine.
import { prepareShader } from "@vgpu/wgsl/prepare";

const DEEP_FREEZE = `const freeze = (value) => {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};`;

export const prepared_module = (header, wgsl, path) =>
  [
    header,
    DEEP_FREEZE,
    "",
    `export default /* @__PURE__ */ freeze(${JSON.stringify(prepareShader(wgsl, path), null, 2)});`,
    "",
  ].join("\n");
