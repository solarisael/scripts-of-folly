import { expect, test } from "bun:test";
import { draw, effect, init } from "vgpu/mock";
import {
  shader_glsl,
  shader_module,
} from "../../src/webgl2/shader_module.js";
import text_shader from "../../src/gpu/wgsl.generated.js";
import scene_shader from "../../src/scene/wgsl.generated.js";
import banner_shader from "../../src/vision/wgsl.generated.js";
import terminal_shader from "../../src/terminal/terminal_shader.js";

const deeply_frozen = (value) =>
  value === null ||
  typeof value !== "object" ||
  (Object.isFrozen(value) && Object.values(value).every(deeply_frozen));

test("vgpu takes each generated shader as Folly passes it", async () => {
  const gpu = await init();
  try {
    for (const shader of [
      text_shader,
      scene_shader,
      banner_shader,
      terminal_shader,
    ]) {
      expect(shader.version).toBe(2);
      expect(deeply_frozen(shader)).toBe(true);
    }
    expect(() => draw(gpu, { shader: text_shader, vertices: 6 })).not.toThrow();
    expect(() =>
      draw(gpu, { shader: banner_shader, vertices: 6 }),
    ).not.toThrow();
    expect(() => effect(gpu, scene_shader)).not.toThrow();
    expect(() => effect(gpu, terminal_shader)).not.toThrow();
    // vgpu 0.6 refuses the raw WGSL that Folly passed before.
    expect(() => effect(gpu, scene_shader.wgsl)).toThrow(
      "prepared ShaderSource v2",
    );
  } finally {
    gpu.dispose();
  }
});

test("shader_module returns the shader itself and keeps its GLSL", () => {
  const glsl = { frag: "#version 300 es", vert: "#version 300 es" };
  expect(shader_module(scene_shader, glsl)).toBe(scene_shader);
  expect(shader_glsl(scene_shader)).toEqual(glsl);
  expect(deeply_frozen(scene_shader)).toBe(true);
});

test("shader_module refuses raw WGSL, a v1 artifact and a missing fragment", () => {
  const frag = "#version 300 es";
  expect(() => shader_module(scene_shader.wgsl, { frag })).toThrow(TypeError);
  expect(() =>
    shader_module({ version: 1, wgsl: scene_shader.wgsl }, { frag }),
  ).toThrow(TypeError);
  expect(() => shader_module(scene_shader, {})).toThrow(TypeError);
});
