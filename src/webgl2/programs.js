// GLSL programs, effects and draws for the WebGL2 leg.
//
// Rows match WebGPU: row 0 is the top in every target, and uv.y and
// gl_FragCoord.y grow downward. naga flips clip y in generated vertex shaders
// and the fullscreen triangle below puts uv.y = 0 on row 0; only present
// (./surfaces.js) flips.

import { GLSL_BINDING, block_layout, bind_block } from "./uniforms.js";
import { bind_texture } from "./textures.js";

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
smooth out vec2 _vs2fs_location0;
void main() {
    vec2 corner = vec2(float((gl_VertexID & 1) << 2), float((gl_VertexID & 2) << 1));
    _vs2fs_location0 = corner * 0.5;
    gl_Position = vec4(corner - 1.0, 0.0, 1.0);
}
`;

const BLEND_PRESETS = {
  alpha: ["SRC_ALPHA", "ONE_MINUS_SRC_ALPHA", "ONE", "ONE_MINUS_SRC_ALPHA"],
  premultiplied: ["ONE", "ONE_MINUS_SRC_ALPHA", "ONE", "ONE_MINUS_SRC_ALPHA"],
  additive: ["ONE", "ONE", "ONE", "ONE"],
};

const TOPOLOGIES = {
  "triangle-list": "TRIANGLES",
  "triangle-strip": "TRIANGLE_STRIP",
  "line-list": "LINES",
  "line-strip": "LINE_STRIP",
  "point-list": "POINTS",
};

const REFUSED_DRAW_OPTIONS = ["geometry", "colors", "stencil", "blendConstant"];

const WGSL_BINDING =
  /@(group|binding)\((\d+)\)\s*@(?:group|binding)\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)/g;
const WGSL_SAMPLED = /textureSample\w*\(\s*(\w+)\s*,\s*(\w+)/g;

const drawables = new WeakMap();

const wgsl_bindings = (wgsl, label) => {
  const names = new Map();
  for (const [, first, a, b, name] of wgsl.matchAll(WGSL_BINDING)) {
    const [group, binding] = first === "group" ? [a, b] : [b, a];
    names.set(`${group}_${binding}`, name);
  }
  const samplers = new Map();
  for (const [, texture, paired] of wgsl.matchAll(WGSL_SAMPLED)) {
    const known = samplers.get(texture);
    if (known && known !== paired) {
      throw new Error(
        `${label}: ${texture} is sampled with ${known} and ${paired}; GLSL binds one sampler per texture.`,
      );
    }
    samplers.set(texture, paired);
  }
  return { names, samplers };
};

const binding_name = (bindings, glsl_name, label) => {
  const match = GLSL_BINDING.exec(glsl_name);
  const name = match && bindings.names.get(`${match[1]}_${match[2]}`);
  if (!name) {
    throw new Error(`${label}: no WGSL binding behind GLSL "${glsl_name}".`);
  }
  return name;
};

const reflect_program = (gl, handle, bindings, label) => {
  const blocks = new Map();
  const block_count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORM_BLOCKS);
  for (let block = 0; block < block_count; block += 1) {
    const layout = block_layout(gl, handle, block, label);
    const name = binding_name(bindings, layout.first_member, label);
    if (!blocks.has(name))
      blocks.set(name, { name, point: blocks.size, layout });
    gl.uniformBlockBinding(handle, block, blocks.get(name).point);
  }

  gl.useProgram(handle);
  const textures = new Map();
  const uniform_count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
  const uniforms = [...Array(uniform_count).keys()];
  const block_of = gl.getActiveUniforms(
    handle,
    uniforms,
    gl.UNIFORM_BLOCK_INDEX,
  );
  for (const uniform of uniforms) {
    const { name: glsl_name } = gl.getActiveUniform(handle, uniform);
    if (block_of[uniform] !== -1 || !GLSL_BINDING.test(glsl_name)) continue;
    const name = binding_name(bindings, glsl_name, label);
    if (!textures.has(name)) {
      const paired = bindings.samplers.get(name);
      textures.set(name, { name, sampler: paired, unit: textures.size });
    }
    const location = gl.getUniformLocation(handle, glsl_name);
    gl.uniform1i(location, textures.get(name).unit);
  }

  return {
    handle,
    blocks: [...blocks.values()],
    textures: [...textures.values()],
    first_instance: gl.getUniformLocation(handle, "naga_vs_first_instance"),
  };
};

const compile_shader = (gl, stage, source, label) => {
  const shader = gl.createShader(stage);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(
      `${label}: GLSL compile failed. ${gl.getShaderInfoLog(shader)}`,
    );
  }
  return shader;
};

const link_program = (gpu, source, label) => {
  const { gl } = gpu;
  const vertex = source.glsl.vert ?? FULLSCREEN_VERTEX;
  const key = `${vertex}\n${source.glsl.frag}`;
  const cached = gpu.programs.get(key);
  if (cached) return cached;

  const handle = gl.createProgram();
  gl.attachShader(handle, compile_shader(gl, gl.VERTEX_SHADER, vertex, label));
  gl.attachShader(
    handle,
    compile_shader(gl, gl.FRAGMENT_SHADER, source.glsl.frag, label),
  );
  gl.linkProgram(handle);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    throw new Error(
      `${label}: GLSL link failed. ${gl.getProgramInfoLog(handle)}`,
    );
  }
  const program = reflect_program(
    gl,
    handle,
    wgsl_bindings(source.wgsl, label),
    label,
  );
  gpu.programs.set(key, program);
  return program;
};

const apply_output = (gl, state) => {
  const blend = state.blend;
  if (blend) {
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(...blend.map((factor) => gl[factor]));
  } else {
    gl.disable(gl.BLEND);
  }
  gl.colorMask(...state.write_mask);
};

const use_program = (state) => {
  const { gl } = state.gpu;
  state.program ??= link_program(state.gpu, state.source, state.label);
  const program = state.program;
  gl.useProgram(program.handle);
  for (const block of program.blocks) bind_block(state, block);
  for (const binding of program.textures) bind_texture(state, binding);
  state.dirty = false;
  apply_output(gl, state);
  return program;
};

const draw_arrays = (state, program, call) => {
  const { gl } = state.gpu;
  const counts = { ...state.counts, ...call };
  if (program.first_instance) {
    gl.uniform1ui(program.first_instance, counts.firstInstance ?? 0);
  } else if (counts.firstInstance) {
    throw new Error(`${state.label}: firstInstance needs instance_index.`);
  }
  gl.drawArraysInstanced(
    state.mode,
    counts.firstVertex ?? 0,
    counts.vertices,
    counts.instances ?? 1,
  );
};

export const encode = (drawable, call = {}) => {
  const state = drawables.get(drawable);
  if (!state) throw new Error("frame.pass takes a WebGL2 effect or draw.");
  draw_arrays(state, use_program(state), call);
};

const output_state = (gl, options, label) => {
  const blend = options.blend && BLEND_PRESETS[options.blend];
  if (options.blend && !blend) {
    throw new Error(`${label}: the WebGL2 leg mirrors blend presets only.`);
  }
  const topology = TOPOLOGIES[options.topology ?? "triangle-list"];
  if (!topology)
    throw new Error(`${label}: no "${options.topology}" topology.`);
  const mask = options.writeMask ?? ["r", "g", "b", "a"];
  return {
    blend,
    write_mask: ["r", "g", "b", "a"].map((channel) => mask.includes(channel)),
    mode: gl[topology],
  };
};

const create_drawable = (gpu, source, options, counts) => {
  const label = options.label ?? "effect";
  if (typeof source?.glsl?.frag !== "string") {
    throw new Error(
      `${label}: the WebGL2 leg needs shader_module(wgsl, { frag }) from scripts-of-folly/webgl2.`,
    );
  }
  const state = {
    gpu,
    source,
    label,
    bag: { ...options.set },
    dirty: true,
    program: null,
    buffers: new Map(),
    ...output_state(gpu.gl, options, label),
    counts,
  };
  const drawable = {
    set(values) {
      Object.assign(state.bag, values);
      state.dirty = true;
      return drawable;
    },
    compileSync() {
      state.program ??= link_program(gpu, source, label);
      return drawable;
    },
    async compile() {
      return drawable.compileSync();
    },
  };
  drawables.set(drawable, state);
  return drawable;
};

export const effect = (gpu, source, options = {}) =>
  create_drawable(gpu, source, options, { vertices: 3, instances: 1 });

const refused_draw_options = (options) => {
  const refused = REFUSED_DRAW_OPTIONS.filter((key) => key in options);
  if (options.cull && options.cull !== "none") refused.push("cull");
  return refused;
};

export const draw = (gpu, options) => {
  const label = options.label ?? "draw";
  const refused = refused_draw_options(options);
  if (refused.length) {
    throw new Error(`${label}: the WebGL2 leg does not mirror ${refused}.`);
  }
  if (typeof options.shader?.glsl?.vert !== "string") {
    throw new Error(`${label}: a WebGL2 draw needs a generated .vert.`);
  }
  return create_drawable(gpu, options.shader, options, {
    vertices: options.vertices ?? 3,
    instances: options.instances ?? 1,
    firstInstance: options.firstInstance ?? 0,
  });
};
