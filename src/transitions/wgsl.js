// The page transition cover. Both legs run it: vgpu reads the WGSL, and the
// WebGL2 leg runs the naga GLSL from scripts/build_glsl.js.
//
// The cover is paper. At full coverage it is exactly the paper colour, so a
// covered page shows a blank sheet. The frontier between page and paper
// carries the ink of the effect.
//
// `progress` is the eased animation, 0 to 1. A frontier grows from the origin
// with progress in both phases. On the "cover" phase (phase 0) the paper fills
// the frontier. On the "reveal" phase (phase 1) the new page fills it, so the
// new page opens where the old one closed.
//
// Noise hashes integer lattice cells with pcg3d from @vgpu/wgsl-std, so both
// legs get the same values (a sin-based hash diverges between compilers).
export const COVER_EFFECTS = Object.freeze({ ink: 0, fog: 1 });

export const COVER_WGSL = /* wgsl */ `
struct Cover {
  paper: vec4f,
  ink: vec4f,
  size: vec2f,
  origin: vec2f,
  progress: f32,
  phase: f32,
  effect: f32,
  time: f32,
  seed: u32,
}

@group(0) @binding(0) var<uniform> cover: Cover;

// pcg3d and unit_float are adapted from @vgpu/wgsl-std 0.5 (src/hash).
// MIT License, Copyright (c) 2025 Vercel, Inc.
fn pcg3d(value: vec3u) -> vec3u {
  var hashed = value * 1664525u + 1013904223u;
  hashed.x = hashed.x + hashed.y * hashed.z;
  hashed.y = hashed.y + hashed.z * hashed.x;
  hashed.z = hashed.z + hashed.x * hashed.y;
  hashed = hashed ^ (hashed >> vec3u(16u));
  hashed.x = hashed.x + hashed.y * hashed.z;
  hashed.y = hashed.y + hashed.z * hashed.x;
  hashed.z = hashed.z + hashed.x * hashed.y;
  hashed = hashed ^ (hashed >> vec3u(16u));
  return hashed;
}

fn unit_float(hash: u32) -> f32 {
  return f32(hash >> 8u) * (1.0 / 16777216.0);
}

fn lattice(cell: vec2i, seed: u32) -> f32 {
  return unit_float(pcg3d(vec3u(bitcast<vec2u>(cell), seed)).x);
}

fn value_noise(point: vec2f, seed: u32) -> f32 {
  let floor_point = floor(point);
  let local = point - floor_point;
  let weight = local * local * (3.0 - 2.0 * local);
  let cell = vec2i(floor_point);

  let top = mix(lattice(cell, seed), lattice(cell + vec2i(1, 0), seed), weight.x);
  let bottom = mix(
    lattice(cell + vec2i(0, 1), seed),
    lattice(cell + vec2i(1, 1), seed),
    weight.x,
  );
  return mix(top, bottom, weight.y);
}

fn fbm(point: vec2f, seed: u32) -> f32 {
  var total = 0.0;
  var amplitude = 0.5;
  var position = point;
  for (var octave = 0u; octave < 4u; octave += 1u) {
    total += value_noise(position, seed + octave * 101u) * amplitude;
    position = position * 2.03 + vec2f(17.1, 9.7);
    amplitude *= 0.5;
  }
  return total / 0.9375;
}

// The frontier for this frame. It travels from below the lowest field value
// (nothing inside) to above the highest (everything inside).
fn threshold(low: f32, high: f32) -> f32 {
  return mix(low, high, cover.progress);
}

// Paper coverage for a field value. Inside the frontier is paper on the cover
// phase and the new page on the reveal phase.
fn coverage(field: f32, edge: f32, softness: f32) -> f32 {
  let inside = 1.0 - smoothstep(edge - softness, edge + softness, field);
  return select(inside, 1.0 - inside, cover.phase > 0.5);
}

// The frontier ink fades in and out at the ends, so progress 0 shows nothing
// on the cover phase and progress 1 shows nothing on the reveal phase.
fn ink_life() -> f32 {
  return smoothstep(0.0, 0.12, cover.progress) * smoothstep(0.0, 0.12, 1.0 - cover.progress);
}

struct Layer {
  paper: f32,
  ink: f32,
}

// Ink: the paper floods out from the origin. Its frontier is an ink stain
// that bleeds a little ahead of the paper.
fn ink_layer(point: vec2f, aspect: f32) -> Layer {
  let origin = vec2f(cover.origin.x * aspect, cover.origin.y);
  let far = max(
    max(length(origin), length(origin - vec2f(aspect, 0.0))),
    max(length(origin - vec2f(0.0, 1.0)), length(origin - vec2f(aspect, 1.0))),
  );
  let drift = vec2f(cover.time * 0.03, -cover.time * 0.02);
  let warp = fbm(point * 2.6 + drift, cover.seed) - 0.5;
  let fine = fbm(point * 9.0 - drift, cover.seed + 7u) - 0.5;
  let field = length(point - origin) / max(far, 0.001) + warp * 0.42 + fine * 0.1;

  let edge = threshold(-0.36, 1.42);
  let offset = field - edge;
  let band = exp(-(offset * offset) / (0.075 * 0.075));
  let fibres = fbm(point * 15.0 + drift * 2.0, cover.seed + 13u);
  let stain = band * smoothstep(0.25, 0.8, fibres + band * 0.35);

  var layer: Layer;
  layer.paper = coverage(field, edge, 0.012);
  layer.ink = stain * 0.85;
  return layer;
}

// Fog: soft banks of paper condense over the whole page at once.
fn fog_layer(point: vec2f, uv: vec2f) -> Layer {
  let drift = vec2f(cover.time * 0.05, -cover.time * 0.015);
  let banks = fbm(point * 1.5 + drift, cover.seed);
  let field = banks * 0.8 + (1.0 - uv.y) * 0.2;

  let edge = threshold(-0.25, 1.25);
  let offset = field - edge;
  let band = exp(-(offset * offset) / (0.14 * 0.14));
  let wisps = fbm(point * 4.5 - drift * 1.5, cover.seed + 5u);

  var layer: Layer;
  layer.paper = coverage(field, edge, 0.14);
  layer.ink = band * smoothstep(0.35, 0.85, wisps) * 0.22;
  return layer;
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let position = positions[vertex_index];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let aspect = cover.size.x / max(cover.size.y, 1.0);
  let point = vec2f(input.uv.x * aspect, input.uv.y);

  var layer: Layer;
  if (cover.effect > 0.5) {
    layer = fog_layer(point, input.uv);
  } else {
    layer = ink_layer(point, aspect);
  }

  // Ahead of the paper the stain is pure ink at partial alpha. On the paper
  // it tints the sheet. At full coverage the colour is exactly the paper.
  let ink = clamp(layer.ink, 0.0, 1.0) * ink_life();
  let alpha = max(layer.paper, ink);
  let tint = clamp(ink / max(alpha, 0.0001), 0.0, 1.0) * mix(1.0, ink, layer.paper);
  let color = mix(cover.paper.rgb, cover.ink.rgb, tint);
  return vec4f(color, alpha);
}
`;
