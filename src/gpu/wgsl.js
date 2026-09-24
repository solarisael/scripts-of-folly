import { BLUR_RADII, WIDE_CAPTURE_PADDING } from "./blur_levels.js";
import { TRANSITION_WGSL } from "./transition_wgsl.js";

export const EFFECT_SLOTS = Object.freeze({
  glow: 0,
  neon: 1,
  shadow: 2,
  chroma: 3,
  blur: 4,
  flicker: 5,
  rainbow: 6,
  gradient: 7,
  aura: 8,
  etch: 9,
  whisper: 10,
  sigil_pulse: 11,
  veil: 12,
  cadence_oracular: 13,
  wiggle: 14,
  float: 15,
  shake: 16,
  glitch: 17,
  skill_popup: 18,
  rift: 19,
});

/*
The ink simplex functions below include code adapted from @vgpu/wgsl-std 0.4.1.

MIT License
Copyright (c) 2025 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

export const WGSL_SOURCE = String.raw`
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) css: vec2f,
};

@group(0) @binding(0) var<uniform> frame: vec4f;
@group(0) @binding(1) var<uniform> rect: vec4f;
@group(0) @binding(2) var<uniform> clip: vec4f;
@group(0) @binding(3) var<uniform> surface: vec4f;
@group(0) @binding(4) var<uniform> base: vec4f;
@group(0) @binding(5) var<uniform> settings: array<vec4f, 20>;
@group(0) @binding(6) var<uniform> colors: array<vec4f, 20>;
@group(0) @binding(7) var<uniform> order: array<vec4f, 20>;
@group(0) @binding(8) var<uniform> order_count: vec4f;
@group(0) @binding(9) var glyph: texture_2d<f32>;
@group(0) @binding(10) var glyph_sampler: sampler;
@group(0) @binding(11) var<uniform> transition: vec4f;
@group(0) @binding(12) var soft_glyph: texture_2d<f32>;

fn ordered_slot(slot: u32) -> bool {
  let count = u32(order_count.x);
  for (var index: u32 = 0u; index < 20u; index = index + 1u) {
    if (index >= count) {
      break;
    }
    if (u32(order[index].x) == slot) {
      return true;
    }
  }
  return false;
}

fn effect_active(slot: u32) -> bool {
  return ordered_slot(slot) && settings[slot].x > 0.0;
}

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453);
}

// Keep the plume field on the menu's @vgpu/wgsl-std 0.4.1 simplex lattice.
fn ink_pcg3(value: vec3u) -> vec3u {
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

fn ink_grad_dot(index: u32, d: vec3f) -> f32 {
  let pair = index / 4u;
  let a = select(d.x, d.y, pair == 2u);
  let b = select(select(d.y, d.z, pair == 1u), d.z, pair == 2u);
  let sa = select(a, -a, (index & 1u) != 0u);
  let sb = select(b, -b, (index & 2u) != 0u);
  return sa + sb;
}

fn ink_simplex_kernel(cell: vec3i, d: vec3f) -> f32 {
  let t = 0.5 - dot(d, d);
  if (t <= 0.0) { return 0.0; }
  let t2 = t * t;
  let index = ink_pcg3(bitcast<vec3u>(cell)).x % 12u;
  return t2 * t2 * ink_grad_dot(index, d);
}

fn ink_simplex(position: vec3f) -> f32 {
  let skew = (position.x + position.y + position.z) * 0.3333333333333333;
  let base = floor(position + vec3f(skew));
  let cell = vec3i(base);
  let unskew = (base.x + base.y + base.z) * 0.16666666666666666;
  let d0 = position - (base - vec3f(unskew));
  var o1 = vec3f(0.0);
  var o2 = vec3f(0.0);
  if (d0.x >= d0.y) {
    if (d0.y >= d0.z)      { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); }
    else if (d0.x >= d0.z) { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 0.0, 1.0); }
    else                   { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(1.0, 0.0, 1.0); }
  } else {
    if (d0.y < d0.z)       { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(0.0, 1.0, 1.0); }
    else if (d0.x < d0.z)  { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(0.0, 1.0, 1.0); }
    else                   { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); }
  }
  let d1 = d0 - o1 + vec3f(0.16666666666666666);
  let d2 = d0 - o2 + vec3f(0.3333333333333333);
  let d3 = d0 - vec3f(1.0) + vec3f(0.5);
  let total = ink_simplex_kernel(cell, d0)
    + ink_simplex_kernel(cell + vec3i(o1), d1)
    + ink_simplex_kernel(cell + vec3i(o2), d2)
    + ink_simplex_kernel(cell + vec3i(1, 1, 1), d3);
  return 76.0 * total;
}

fn ink_fbm(position: vec3f) -> f32 {
  var sum = 0.0;
  var amplitude = 1.0;
  var sample = position;
  for (var i = 0; i < 3; i = i + 1) {
    sum += amplitude * ink_simplex(sample);
    sample *= 2.0;
    amplitude *= 0.5;
  }
  return sum / 1.75;
}


fn menu_sdr(color: vec3f) -> vec3f {
  let encoded = select(
    pow(color, vec3f(1.0 / 2.4)) * 1.055 - vec3f(0.055),
    color * 12.92,
    color <= vec3f(0.0031308)
  );
  return mix(color, encoded, 0.42);
}

fn effect_color(slot: u32) -> vec3f {
  let candidate = colors[slot].rgb;
  let present = max(candidate.x, max(candidate.y, candidate.z)) > 0.0001;
  return select(base.rgb, candidate, present);
}

fn sample_rgba(uv: vec2f) -> vec4f {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4f(0.0);
  }
  return textureSampleLevel(glyph, glyph_sampler, uv, 0.0);
}

fn sample_mask(uv: vec2f) -> f32 {
  return sample_rgba(uv).a;
}
fn sample_soft_mask(uv: vec2f, layer: f32) -> f32 {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return 0.0;
  }
  let atlas_uv = vec2f(uv.x, (layer + uv.y) / ${BLUR_RADII.length}.0);
  return textureSampleLevel(soft_glyph, glyph_sampler, atlas_uv, 0.0).a;
}

fn soft_mask(uv: vec2f, radius: vec2f) -> f32 {
  let radii = array<f32, ${BLUR_RADII.length}>(${BLUR_RADII.map((value) => `${value}.0`).join(", ")});
  let requested = max(radius.x * surface.x, radius.y * surface.y);
  var level = f32(${BLUR_RADII.length - 1});
  for (var index = 0; index < ${BLUR_RADII.length - 1}; index += 1) {
    if (requested <= radii[index + 1]) {
      level = f32(index) + clamp(
        (requested - radii[index]) / (radii[index + 1] - radii[index]),
        0.0, 1.0
      );
      break;
    }
  }

  let lower = floor(level);
  return mix(
    sample_soft_mask(uv, lower),
    sample_soft_mask(uv, min(lower + 1.0, f32(${BLUR_RADII.length - 1}))),
    fract(level)
  );
}

fn over(under: vec4f, rgb: vec3f, alpha: f32) -> vec4f {
  let source_alpha = clamp(alpha, 0.0, 1.0);
  let under_alpha = clamp(under.a, 0.0, 1.0);
  let output_alpha = source_alpha + under_alpha * (1.0 - source_alpha);
  let output_rgb = (rgb * source_alpha + under.rgb * under_alpha * (1.0 - source_alpha))
    / max(output_alpha, 0.00001);
  return vec4f(output_rgb, output_alpha);
}

fn css_to_uv(offset: vec2f) -> vec2f {
  return offset / max(surface.xy, vec2f(1.0));
}

fn wiggle_motion(phase: f32) -> vec3f {
  let p = fract(phase);
  if (p < 0.25) {
    return mix(vec3f(0.0, 0.0, 0.0), vec3f(0.0, -0.075, -0.55), p * 4.0);
  }
  if (p < 0.50) {
    return mix(vec3f(0.0, -0.075, -0.55), vec3f(0.0, 0.075, 0.55), (p - 0.25) * 4.0);
  }
  if (p < 0.75) {
    return mix(vec3f(0.0, 0.075, 0.55), vec3f(0.0, -0.0375, 0.35), (p - 0.50) * 4.0);
  }
  return mix(vec3f(0.0, -0.0375, 0.35), vec3f(0.0, 0.0, 0.0), (p - 0.75) * 4.0);
}

fn flicker_alpha(phase: f32, motion: f32) -> f32 {
  let p = fract(phase);
  if (p < 0.04) {
    return mix(1.0, 1.0 - 0.45 * motion, p / 0.04);
  }
  if (p < 0.06) {
    return mix(1.0 - 0.45 * motion, 1.0 - 0.05 * motion, (p - 0.04) / 0.02);
  }
  if (p < 0.08) {
    return mix(1.0 - 0.05 * motion, 1.0 - 0.30 * motion, (p - 0.06) / 0.02);
  }
  if (p < 0.10) {
    return mix(1.0 - 0.30 * motion, 1.0, (p - 0.08) / 0.02);
  }
  if (p < 0.46) {
    return mix(1.0, 1.0 - 0.38 * motion, (p - 0.10) / 0.36);
  }
  if (p < 0.49) {
    return mix(1.0 - 0.38 * motion, 1.0, (p - 0.46) / 0.03);
  }
  if (p < 0.52) {
    return mix(1.0, 1.0 - 0.62 * motion, (p - 0.49) / 0.03);
  }
  if (p < 0.54) {
    return mix(1.0 - 0.62 * motion, 1.0 - 0.08 * motion, (p - 0.52) / 0.02);
  }
  if (p < 0.86) {
    return mix(1.0 - 0.08 * motion, 1.0 - 0.42 * motion, (p - 0.54) / 0.32);
  }
  if (p < 0.90) {
    return mix(1.0 - 0.42 * motion, 1.0, (p - 0.86) / 0.04);
  }
  return 1.0;
}

fn shake_motion(phase: f32) -> vec2f {
  let step_phase = floor(fract(phase) * 4.0);
  if (step_phase < 1.0) {
    return vec2f(0.0, 0.0);
  }
  if (step_phase < 2.0) {
    return vec2f(0.1, -0.075);
  }
  if (step_phase < 3.0) {
    return vec2f(-0.1, 0.075);
  }
  return vec2f(0.075, 0.1);
}

fn glitch_motion(phase: f32) -> vec2f {
  let step_phase = floor(fract(phase) * 5.0);
  if (step_phase < 1.0) {
    return vec2f(0.0, 0.0);
  }
  if (step_phase < 2.0) {
    return vec2f(-0.075, 0.04);
  }
  if (step_phase < 3.0) {
    return vec2f(0.075, -0.04);
  }
  if (step_phase < 4.0) {
    return vec2f(-0.04, -0.06);
  }
  return vec2f(0.06, 0.04);
}

${TRANSITION_WGSL}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  var points = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
  );

  let uv = points[vertex_index];
  let css = rect.xy + uv * surface.xy;
  let ndc = vec2f(css.x / max(frame.x, 1.0) * 2.0 - 1.0,
    1.0 - css.y / max(frame.y, 1.0) * 2.0);

  var output: VertexOut;
  output.position = vec4f(ndc, 0.0, 1.0);
  output.uv = uv;
  output.css = css;
  return output;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4f {
  let time = frame.z;
  let dpr = max(frame.w, 1.0);
  var uv = input.uv;
  var motion_scale = 1.0;

  if (effect_active(14u)) {
    let speed = max(settings[14].z, 0.001);
    let motion = wiggle_motion(time * speed / 1.3);
    let amount = settings[14].x * settings[14].y;
    let angle = motion.z * 0.0174532925 * amount;
    let centered = uv - vec2f(0.5);
    let rotated = vec2f(
      centered.x * cos(angle) - centered.y * sin(angle),
      centered.x * sin(angle) + centered.y * cos(angle)
    );
    uv = vec2f(0.5) + rotated;
    uv.y += motion.y * amount * max(surface.z, 1.0) / max(surface.y, 1.0);
  }

  if (effect_active(15u)) {
    let speed = max(settings[15].z, 0.001);
    let amount = settings[15].x * settings[15].y;
    let phase = fract(time * speed / 2.8);
    uv.y -= sin(phase * 3.14159265) * amount * 0.4 * max(surface.z, 1.0) / max(surface.y, 1.0);
  }

  if (effect_active(16u)) {
    let speed = max(settings[16].z, 0.001);
    let amount = settings[16].x * settings[16].y * max(surface.z, 1.0) / max(surface.xy, vec2f(1.0));
    uv += shake_motion(time * speed / 0.7) * amount;
  }

  if (effect_active(17u)) {
    let speed = max(settings[17].z, 0.001);
    let amount = settings[17].x * settings[17].y * max(surface.z, 1.0) / max(surface.xy, vec2f(1.0));
    uv += glitch_motion(time * speed / 1.05) * amount;
  }

  if (effect_active(11u)) {
    let phase = fract(time * max(settings[11].z, 0.001) / 2.4);
    let pulse = sin(phase * 3.14159265);
    uv.y -= pulse * settings[11].x * settings[11].y * 0.075 * max(surface.z, 1.0) / max(surface.y, 1.0);
  }

  if (input.css.x < clip.x || input.css.y < clip.y
      || input.css.x > clip.z || input.css.y > clip.w) {
    return vec4f(0.0);
  }

  if (transition.x > 0.5) {
    return transition_ink(uv);
  }

  let base_mask = sample_mask(uv);
  var core_mask = base_mask;
  var output = vec4f(0.0);
  var rift_pigment = 0.0;
  let px = vec2f(dpr / max(surface.x, 1.0), dpr / max(surface.y, 1.0));

  if (effect_active(2u)) {
    let strength = settings[2].x * 1.55;
    let shadow_offset = css_to_uv(vec2f(strength * surface.z * 0.16, strength * surface.z * 0.18));
    output = over(output, vec3f(0.0), soft_mask(uv - shadow_offset, px * 2.0) * 0.86);
    output = over(output, vec3f(0.0), soft_mask(uv - shadow_offset * 1.8, px * 2.0) * 0.64);
    output = over(output, vec3f(0.0), soft_mask(uv - shadow_offset * 3.0, px * 2.0) * 0.38);
    output = over(output, effect_color(2u), soft_mask(uv, px * 1.5) * 0.22);
  }

  if (effect_active(19u)) {
    let aspect = surface.x / surface.y;
    let p = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
    let drift = time * 0.07;
    let current = vec2f(
      ink_fbm(vec3f(p * 1.65, drift)),
      ink_fbm(vec3f(p * 1.65 + vec2f(13.7, 8.2), drift + 4.3))
    );
    let warped = p + current * 0.12 * min(aspect, 1.0);
    let body_signal = ink_fbm(vec3f(warped * 3.4 + current * 0.8, drift * 0.6));
    let eddies = ink_simplex(vec3f(warped * 8.0 + current * 2.2, drift * 0.45));

    let margin = vec2f(0.4, 0.9) * surface.z * settings[19].x;
    let extent = max(
      surface.xy * 0.5 - vec2f(${WIDE_CAPTURE_PADDING}.0) + margin,
      vec2f(surface.z * 0.55)
    ) / surface.y;
    let normalized = abs(warped / extent);
    let radius = pow(pow(normalized.x, 3.0) + pow(normalized.y, 3.0), 1.0 / 3.0);
    let edge = radius - 1.0 + body_signal * 0.18 + eddies * 0.035;
    let dense = 1.0 - smoothstep(-0.035, 0.035, edge);
    let wash = 1.0 - smoothstep(-0.015, 0.20, edge + body_signal * 0.05);
    let mist = (1.0 - smoothstep(-0.015, 0.55, edge + body_signal * 0.05))
      * (0.08 + 0.12 * smoothstep(0.34, 0.67, body_signal * 0.5 + 0.5));
    let pigment = max(clamp(dense * 0.98 + wash * 0.22, 0.0, 0.995), mist);
    rift_pigment = pigment;
    let wet_edge = max(wash - dense, 0.0) * 0.012;

    // The plume field and palette follow Solarisael's portal ink shaders.
    let shadow = vec3f(0.001, 0.0015, 0.0025)
      + vec3f(0.45, 0.55, 0.65) * wet_edge
      + vec3f(0.002, 0.003, 0.004) * clamp(body_signal + 0.5, 0.0, 1.0);
    let radiance = mix(vec3f(0.72, 0.70, 0.63), vec3f(1.0, 0.98, 0.91),
      clamp(body_signal + 0.5 + wet_edge * 12.0, 0.0, 1.0));
    let dark_scheme = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));
    let palette = menu_sdr(mix(shadow, radiance, dark_scheme));
    let color = select(palette, effect_color(19u), colors[19].a > 0.5);
    output = over(output, color, pigment);
  }

  if (effect_active(0u)) {
    let strength = settings[0].x * 1.35;
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, effect_color(0u), soft_mask(uv, unit * (0.72 * strength)) * 0.20);
    output = over(output, effect_color(0u), soft_mask(uv, unit * (0.42 * strength)) * 0.36);
    output = over(output, effect_color(0u), soft_mask(uv, unit * (0.22 * strength)) * 0.58);
  }

  if (effect_active(1u)) {
    let strength = settings[1].x;
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, base.rgb, soft_mask(uv, unit * (0.12 * strength)) * 0.72);
    output = over(output, effect_color(1u), soft_mask(uv, unit * (0.24 * strength)) * 0.52);
    output = over(output, effect_color(1u), soft_mask(uv, unit * (0.4 * strength)) * 0.36);
  }

  if (effect_active(3u)) {
    let strength = settings[3].x;
    let shift = css_to_uv(vec2f(strength * surface.z * 0.05, 0.0));
    output = over(output, vec3f(1.0, 0.32, 0.52), sample_mask(uv - shift) * 0.66);
    output = over(output, vec3f(0.31, 0.78, 1.0), sample_mask(uv + shift) * 0.66);
  }

  var core_color = sample_rgba(uv).rgb;
  if (effect_active(19u)) {
    let dark_scheme = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));
    core_color = select(core_color,
      mix(vec3f(1.0, 0.98, 0.91), vec3f(0.002, 0.0025, 0.003), dark_scheme),
      rift_pigment >= 0.5);
  }
  if (effect_active(7u)) {
    let gradient = mix(base.rgb, effect_color(7u), clamp(settings[7].x, 0.0, 1.0));
    let white = vec3f(1.0);
    core_color = mix(mix(base.rgb, white, 0.14), gradient, uv.x);
  }

  if (effect_active(6u)) {
    let phase = uv.x * 6.2831853;
    let rainbow = 0.5 + 0.5 * cos(phase + vec3f(0.0, 2.094, 4.188));
    core_color = mix(core_color, rainbow, clamp(settings[6].x, 0.0, 1.0));
  }

  if (effect_active(4u)) {
    let strength = settings[4].x;
    core_mask = soft_mask(uv, px * (1.0 + 2.0 * strength));
  }

  if (effect_active(8u)) {
    let strength = settings[8].x;
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, effect_color(8u), soft_mask(uv, unit * (0.44 * strength)) * 0.26);
    output = over(output, effect_color(8u), soft_mask(uv, unit * (0.24 * strength)) * 0.42);
  }

  if (effect_active(9u)) {
    let strength = settings[9].x * 1.35;
    let highlight = sample_mask(uv - css_to_uv(vec2f(0.0, surface.z * 0.02)));
    let shade = sample_mask(uv + css_to_uv(vec2f(0.0, surface.z * 0.045)));
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, vec3f(1.0), highlight * 0.18);
    output = over(output, base.rgb, soft_mask(uv, unit * (0.16 * strength)) * 0.38);
    output = over(output, vec3f(0.0), shade * 0.62);
  }

  if (effect_active(10u)) {
    let strength = settings[10].x * 1.45;
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, effect_color(10u), soft_mask(uv, unit * (0.34 * strength)) * 0.16);
    output = over(output, base.rgb, soft_mask(uv, unit * (0.18 * strength)) * 0.32);
    motion_scale *= clamp(0.72 - 0.08 * strength, 0.1, 1.0);
  }

  if (effect_active(11u)) {
    let phase = fract(time * max(settings[11].z, 0.001) / 2.4);
    let pulse = sin(phase * 3.14159265);
    let strength = settings[11].x;
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, effect_color(11u), soft_mask(uv, unit * (0.3 * strength)) * 0.24);
    output = over(output, effect_color(11u), soft_mask(uv, unit * (0.16 * strength)) * 0.44);
    output = over(output, effect_color(11u), base_mask * pulse * 0.05 * strength);
  }

  if (effect_active(12u)) {
    let strength = settings[12].x * 1.45;
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, effect_color(12u), soft_mask(uv, unit * (0.52 * strength)) * 0.24);
    output = over(output, effect_color(12u), soft_mask(uv, unit * (0.24 * strength)) * 0.44);
    output = over(output, vec3f(1.0), soft_mask(uv, unit * (0.85 * strength)) * 0.14);
    let center = 1.0 - smoothstep(0.0, 0.52, abs(uv.x - 0.48));
    output = over(output, effect_color(12u), center * 0.08 * strength);
  }

  if (effect_active(13u)) {
    let oracle = 0.5 + 0.5 * sin(uv.x * 14.0);
    let unit = css_to_uv(vec2f(surface.z, surface.z));
    output = over(output, effect_color(13u), soft_mask(uv, unit * 0.32) * 0.24);
    output = over(output, effect_color(13u), base_mask * oracle * 0.24 * settings[13].x);
  }

  if (effect_active(17u)) {
    let strength = settings[17].x;
    let shift = css_to_uv(vec2f(strength * surface.z * 0.04, 0.0));
    output = over(output, vec3f(1.0, 0.32, 0.52), sample_mask(uv - shift) * 0.64);
    output = over(output, vec3f(0.31, 0.78, 1.0), sample_mask(uv + shift) * 0.64);
  }

  var core_alpha = core_mask * motion_scale;

  if (effect_active(5u)) {
    let speed = max(settings[5].z, 0.001);
    core_alpha *= flicker_alpha(time * speed / 1.8, settings[5].y * 1.25);
  }

  if (effect_active(11u)) {
    let phase = fract(time * max(settings[11].z, 0.001) / 2.4);
    let pulse = sin(phase * 3.14159265);
    core_alpha *= 1.0 - 0.08 * settings[11].y * (1.0 - pulse);
  }

  if (effect_active(12u)) {
    core_alpha *= 1.0 - 0.16 * settings[12].x;
    core_color = mix(core_color, vec3f(1.0), clamp(0.22 + 0.08 * settings[12].x * 1.45, 0.0, 1.0));
  }

  output = over(output, core_color, core_alpha);

  if (surface.w > 0.5 && effect_active(18u)) {
    let edge = min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y));
    let border = 1.0 - smoothstep(0.0, 0.025 + settings[18].x * 0.025, edge);
    output = over(output, effect_color(18u), border * settings[18].x * 0.34);
    let glow = 1.0 - smoothstep(0.0, 0.48, distance(input.uv, vec2f(0.5)));
    output = over(output, effect_color(18u), glow * settings[18].x * 0.05);
  }

  return output;
}
`;
