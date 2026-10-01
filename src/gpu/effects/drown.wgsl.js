import { WIDE_CAPTURE_PADDING } from "../blur_levels.js";

export const DROWN_WGSL = String.raw`
const drown_slot = 20u;
const drown_padding_css = ${WIDE_CAPTURE_PADDING}.0;
const drown_tau = 6.28318531;

// Canvas position in em from the phrase center; y runs down.
fn drown_em(uv: vec2f) -> vec2f {
  return (uv - vec2f(0.5)) * surface.xy / max(surface.z, 1.0);
}

// Still water at motion 0.2; the river is fully awake by 1.
fn drown_live(motion: f32) -> f32 {
  return clamp((motion - 0.2) / 0.8, 0.0, 1.5);
}

// The slow sink: 0 at the surface, 1 at the bottom, once every 7 s of tempo.
fn drown_sink(time: f32, motion: f32, speed: f32) -> f32 {
  let gate = smoothstep(0.4, 0.55, motion);
  return gate * (0.5 - 0.5 * cos(time * speed * drown_tau / 7.0));
}

// Three drops share a 3.6 s beat, a third apart, and each lands somewhere new on the phrase.
// A ring leaves fast and slows like water. Returns the radial push (xy, unit amplitude, em)
// and the brightest crest under this point (z).
fn drown_rings(em: vec2f, beat: f32) -> vec3f {
  let reach = max((surface.xy - vec2f(2.0 * drown_padding_css)) * 0.5 / max(surface.z, 1.0), vec2f(0.3));
  var push = vec2f(0.0);
  var crest = 0.0;
  for (var index = 0u; index < 3u; index = index + 1u) {
    let lane = f32(index);
    let cycle = beat + lane / 3.0;
    let phase = fract(cycle);
    let seed = lane + (floor(cycle) % 61.0) * 1.618;
    let landing = vec2f(
      hash21(vec2f(surface.x + seed, surface.y)),
      hash21(vec2f(surface.y + seed, surface.x + 7.0)),
    ) * 2.0 - 1.0;
    let center = landing * reach * 0.8;
    let rest = 1.0 - phase;
    let radius = mix(0.12, 2.4, 1.0 - rest * rest);
    let offset = em - center;
    let distance_em = length(offset);
    let band = (distance_em - radius) / 0.25;
    let shape = sin(16.5 * (distance_em - radius)) * exp(-band * band);
    let fade = pow(rest, 1.5) * smoothstep(0.0, 0.06, phase);
    push += offset / max(distance_em, 0.001) * shape * fade;
    crest = max(crest, smoothstep(0.7, 0.98, abs(shape)) * fade);
  }
  return vec3f(push, crest);
}

fn drown_motion(uv: vec2f, time: f32) -> vec2f {
  let intensity = max(settings[drown_slot].x, 0.0);
  let motion = max(settings[drown_slot].y, 0.0);
  let speed = max(settings[drown_slot].z, 0.001);
  let live = drown_live(motion);
  let em = drown_em(uv);

  let rings = drown_rings(em, time * speed / 3.6).xy * 0.045 * live * clamp(intensity, 0.5, 1.5);
  let drift = time * 0.2 * speed;
  let sway = vec2f(
    ink_fbm(vec3f(em * 0.5 + vec2f(drift, 0.0), drift * 0.5)),
    ink_fbm(vec3f(em * 0.5 + vec2f(13.7, 5.1 - drift * 0.6), drift * 0.5 + 3.0)),
  ) * 0.015 * live;

  // Past 0.07 em the strokes of body text start to tear.
  let bend = rings + sway;
  let held = bend * min(1.0, 0.07 / max(length(bend), 0.0001));
  let sink = drown_sink(time, motion, speed) * 0.05 * min(motion, 1.5);

  // Reading from above the pixel draws the glyph lower.
  return uv - css_to_uv((held + vec2f(0.0, sink)) * surface.z);
}

fn drown_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = max(settings[drown_slot].x, 0.0);
  let motion = max(settings[drown_slot].y, 0.0);
  let speed = max(settings[drown_slot].z, 0.001);
  let live = drown_live(motion);
  let depth = min(intensity, 1.5);
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));
  let em = drown_em(uv);
  let sink = drown_sink(time, motion, speed);

  // With no authored color the accent is the ink itself, so the river brings its own.
  let accent = effect_color(drown_slot);
  let authored = smoothstep(0.02, 0.08, distance(accent, base.rgb));
  let river = mix(vec3f(0.12, 0.33, 0.40), vec3f(0.55, 0.82, 0.88), dark_page);
  let water = mix(river, accent, authored);
  // Warm light ink cancels a 0.35 teal to grey, so dark pages take a little more.
  let steep = mix(0.3, 0.4, dark_page) * depth * (1.0 + 0.3 * sink);
  let tinted = mix(out.core_color, water, clamp(steep, 0.0, 0.8));

  // The word seen through depth: a soft copy beneath the sharp one, bluer than the word
  // and softest at the bottom of the sink.
  let blur_em = (0.03 * intensity + 0.01) * (1.0 + 0.35 * sink);
  let haze = soft_mask(uv, css_to_uv(vec2f(blur_em * surface.z)));
  let deep = mix(out.core_color, water, clamp(steep * 1.6, 0.0, 0.9));
  out.behind = over(out.behind, deep, haze * 0.6 * depth);

  // Ring crests catch the light, but only within reach of the words.
  let crest = drown_rings(em, time * speed / 3.6).z;
  let near = smoothstep(0.02, 0.25, soft_mask(uv, css_to_uv(vec2f(0.4 * surface.z))));
  let glint = mix(water, mix(water, vec3f(1.0), 0.55), dark_page);
  out.behind = over(out.behind, glint, crest * near * 0.15 * live);

  // Caustics wander over the strokes; at motion 0.2 they hold still.
  let flow = time * 0.3 * speed * live;
  let cell = em / 0.35;
  let light = max(
    ink_simplex(vec3f(cell.x + flow * 0.7, cell.y - flow * 0.4, flow)),
    ink_simplex(vec3f(cell * 1.3 + vec2f(7.1 - flow * 0.5, 2.9 + flow * 0.3), flow * 1.2 + 4.0)),
  );
  let fleck = smoothstep(0.55, 0.85, light);
  let caustic_color = vec3f(0.86, 0.97, 1.0);
  let shimmer = fleck * sample_mask(uv) * mix(0.12, 0.3, dark_page) * min(intensity, 2.0) * (0.5 + 0.5 * min(motion, 1.5));
  out.behind = over(out.behind, caustic_color, shimmer);
  // Light ink barely moves toward pale light, so dark pages lift it harder; paper keeps ink as ink.
  out.core_color = mix(tinted, caustic_color, clamp(shimmer * mix(0.8, 2.0, dark_page), 0.0, 0.7));

  // Deeper is fainter, but the letterform keeps at least 0.6 of its ink. On a dark page a passing
  // caustic brings the faded ink back to full, which is what makes light ink read as lit.
  let clarity = clamp(1.0 - 0.25 * intensity * (1.0 + 0.25 * sink), 0.6, 1.0);
  out.core_alpha *= mix(clarity, 1.0, clamp(shimmer * dark_page * 2.5, 0.0, 1.0));
  return out;
}
`;
