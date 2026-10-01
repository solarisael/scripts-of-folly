import { BLUR_RADII } from "../blur_levels.js";

// The widest blur level caps how far the ring can travel; beyond it the field stops growing.
const WIDEST_BLUR = BLUR_RADII[BLUR_RADII.length - 1].toFixed(1);

export const SIGIL_PULSE_WGSL = String.raw`
const sigil_pulse_slot = 11u;

fn sigil_pulse_attack(phase: f32) -> f32 {
  let rise = smoothstep(0.0, 0.12, phase);
  let fall = 1.0 - clamp((phase - 0.12) / 0.88, 0.0, 1.0);
  return rise * fall * fall;
}

// One expanding isoline of the blurred word. Thin strokes blur to a faint field, so the band sits low and sinks as the blur widens.
fn sigil_pulse_ring(uv: vec2f, phase: f32, reach_px: f32) -> f32 {
  // Water rings leave fast and slow down; an eased-in start would park the ring on the letters.
  let travel = 1.0 - (1.0 - phase) * (1.0 - phase);
  let radius_px = mix(0.25 * surface.z, reach_px, travel);
  let field = soft_mask(uv, css_to_uv(vec2f(radius_px, radius_px)));
  let threshold = mix(0.12, 0.035, travel);
  let half_band = threshold / 6.0;
  let band = smoothstep(threshold - half_band, threshold, field)
    * (1.0 - smoothstep(threshold, threshold + half_band, field));
  let fade = pow(1.0 - phase, 1.5) * smoothstep(0.0, 0.12, phase);
  return band * fade;
}

fn sigil_pulse_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[sigil_pulse_slot].x;
  let motion = settings[sigil_pulse_slot].y;
  let speed = max(settings[sigil_pulse_slot].z, 0.001);
  let phase = fract(time * speed / 2.4);
  let lift = sin(phase * 3.14159265);
  let accent = effect_color(sigil_pulse_slot);
  // White ink vanishes on paper, so the answer only whitens on a dark page.
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));
  let accent_white = mix(accent, vec3f(1.0), 0.3 * dark_page);

  let em = surface.z;
  out.behind = over(out.behind, accent, soft_mask(uv, css_to_uv(vec2f(0.3 * em, 0.3 * em))) * 0.15 * intensity);
  out.behind = over(out.behind, accent, soft_mask(uv, css_to_uv(vec2f(0.16 * em, 0.16 * em))) * 0.3 * intensity);

  let reach_px = min((0.25 + 0.9 * clamp(motion, 0.0, 1.5)) * em, ${WIDEST_BLUR});
  let ring_strength = 0.7 * intensity * motion;
  let leading = sigil_pulse_ring(uv, phase, reach_px);
  let trailing = sigil_pulse_ring(uv, fract(phase + 0.5), reach_px) * 0.5;
  // Keep the wave out of letter gaps so body text never reads struck through.
  let clearance = 1.0 - smoothstep(0.03, 0.15, soft_mask(uv, css_to_uv(vec2f(0.2 * em, 0.2 * em))));
  out.behind = over(out.behind, accent_white, max(leading, trailing) * clearance * ring_strength);

  let flash = clamp(0.5 * sigil_pulse_attack(phase) * motion, 0.0, 1.0);
  out.core_color = mix(out.core_color, accent_white, flash);
  out.core_alpha *= 1.0 - 0.08 * motion * (1.0 - lift);
  return out;
}
`;
