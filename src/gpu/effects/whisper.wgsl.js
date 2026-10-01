import { WIDE_CAPTURE_PADDING } from "../blur_levels.js";

export const WHISPER_WGSL = String.raw`
const whisper_slot = 10u;

// Fog condenses toward the page itself: white paper, or the dark page behind light text.
fn whisper_page(dark_page: f32) -> vec3f {
  return mix(vec3f(1.0), vec3f(0.018, 0.02, 0.026), dark_page);
}

fn whisper_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = max(settings[whisper_slot].x, 0.0);
  let motion = max(settings[whisper_slot].y, 0.0);
  let speed = max(settings[whisper_slot].z, 0.001);
  let em = css_to_uv(vec2f(surface.z, surface.z));
  let letters = surface.x / max(surface.z, 1.0) * 0.9;

  let padding = css_to_uv(vec2f(${WIDE_CAPTURE_PADDING}.0, ${WIDE_CAPTURE_PADDING}.0));
  let phrase_x = (uv.x - padding.x) / max(1.0 - 2.0 * padding.x, 0.001);

  // One exhale every 5 s of tempo, crossing the phrase in 1.6 s; the wake behind it lingers and settles.
  let breath_reach = clamp((motion - 0.2) / 0.8, 0.0, 1.5);
  let breath_seconds = fract(time * speed / 5.0) * 5.0;
  let breath_center = -0.25 + 1.5 * (breath_seconds / 1.6);
  let breath_offset = phrase_x - breath_center;
  let breath_band = exp(-(breath_offset * breath_offset) / (0.11 * 0.11));
  let breath_wake = select(0.0, exp(breath_offset / 0.28), breath_offset < 0.0);

  let unevenness = 0.85 + 0.15 * clamp(
    ink_fbm(vec3f(uv.x * letters, uv.y * letters * 0.3, time * 0.05 * speed)),
    -1.0,
    1.0,
  );
  let faded = clamp(0.62 - 0.2125 * (intensity - 1.0), 0.42, 0.92) * unevenness;
  let faintest = mix(0.4, 0.37, clamp(intensity - 1.0, 0.0, 1.0));
  let clearing = clamp(breath_reach * (breath_band + 0.25 * breath_wake), 0.0, 1.0);
  out.core_alpha *= mix(max(faded, faintest), 0.95, clearing);

  let drift = ink_simplex(vec3f(uv.x * letters * 0.35, uv.y * letters * 0.35, time * 0.06 * speed))
    * 0.1 * (0.5 + 0.5 * min(motion, 1.0));
  let fog_uv = uv + vec2f(drift * em.x, 0.0);
  let condensation = clamp(
    0.72 + 0.4 * ink_fbm(vec3f(uv.x * letters * 0.4 + 7.3, uv.y * letters * 0.4, time * 0.07 * speed + 3.1)),
    0.25,
    1.2,
  );
  let exhale = 1.0 + min(breath_reach, 1.0) * clamp(breath_band + 0.6 * breath_wake, 0.0, 1.0);
  let fog_amount = clamp(intensity, 0.0, 2.5) * condensation * exhale;

  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));
  let fog_color = mix(mix(base.rgb, whisper_page(dark_page), 0.5), effect_color(whisper_slot), 0.25);
  let reach = 0.8 + 0.2 * intensity;
  // Thin strokes blur to a weak mask; the lift gives the fog a body instead of a trace.
  let far_fog = pow(soft_mask(fog_uv, em * (0.6 * reach)), 0.6);
  let near_fog = pow(soft_mask(fog_uv, em * (0.3 * reach)), 0.6);
  out.behind = over(out.behind, fog_color, far_fog * 0.12 * fog_amount);
  out.behind = over(out.behind, fog_color, near_fog * 0.22 * fog_amount);
  return out;
}
`;
