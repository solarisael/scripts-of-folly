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
  terminal: 18,
  skill_popup: 19,
});

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

fn soft_mask(uv: vec2f, radius: vec2f) -> f32 {
  let x = vec2f(radius.x, 0.0);
  let y = vec2f(0.0, radius.y);
  let d = vec2f(radius.x, radius.y);
  return sample_mask(uv) * 0.24
    + sample_mask(uv + x) * 0.11
    + sample_mask(uv - x) * 0.11
    + sample_mask(uv + y) * 0.11
    + sample_mask(uv - y) * 0.11
    + sample_mask(uv + d) * 0.05
    + sample_mask(uv + vec2f(-radius.x, radius.y)) * 0.05
    + sample_mask(uv + vec2f(radius.x, -radius.y)) * 0.05
    + sample_mask(uv - d) * 0.05
    + sample_mask(uv + x * 2.0) * 0.03
    + sample_mask(uv - x * 2.0) * 0.03
    + sample_mask(uv + y * 2.0) * 0.03
    + sample_mask(uv - y * 2.0) * 0.03;
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
  let px = vec2f(dpr / max(surface.x, 1.0), dpr / max(surface.y, 1.0));

  if (effect_active(2u)) {
    let strength = settings[2].x * 1.55;
    let shadow_offset = css_to_uv(vec2f(strength * surface.z * 0.16, strength * surface.z * 0.18));
    output = over(output, vec3f(0.0), soft_mask(uv - shadow_offset, px * 2.0) * 0.86);
    output = over(output, vec3f(0.0), soft_mask(uv - shadow_offset * 1.8, px * 2.0) * 0.64);
    output = over(output, vec3f(0.0), soft_mask(uv - shadow_offset * 3.0, px * 2.0) * 0.38);
    output = over(output, effect_color(2u), soft_mask(uv, px * 1.5) * 0.22);
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

  if (surface.w > 0.5) {
    if (effect_active(18u)) {
      let speed = max(settings[18].z, 0.001);
      let scan = 0.5 + 0.5 * sin(input.uv.y * max(surface.y, 1.0) * 4.18879 + time * speed * 1.2);
      output = over(output, effect_color(18u), scan * settings[18].x * 0.12);
    }
    if (effect_active(19u)) {
      let edge = min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y));
      let border = 1.0 - smoothstep(0.0, 0.025 + settings[19].x * 0.025, edge);
      output = over(output, effect_color(19u), border * settings[19].x * 0.34);
      let glow = 1.0 - smoothstep(0.0, 0.48, distance(input.uv, vec2f(0.5)));
      output = over(output, effect_color(19u), glow * settings[19].x * 0.05);
    }
  }

  return output;
}
`;
