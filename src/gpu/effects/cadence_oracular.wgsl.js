import { WIDE_CAPTURE_PADDING } from "../blur_levels.js";

export const CADENCE_ORACULAR_WGSL = String.raw`
const cadence_oracular_slot = 13u;
const cadence_oracular_padding = ${WIDE_CAPTURE_PADDING}.0;

// One reading of the line: 6 s across, 1.5 s resting at the right,
// 3.5 s carried home, 1 s pause. Every turn is eased, so nothing wraps.
fn cadence_oracular_lamp_position(beat: f32) -> f32 {
  let t = fract(beat / 12.0) * 12.0;
  return smoothstep(0.0, 6.0, t) - smoothstep(7.5, 11.0, t);
}

fn cadence_oracular_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let knobs = settings[cadence_oracular_slot];
  let intensity = knobs.x;
  let motion = knobs.y;
  let speed = max(knobs.z, 0.001);
  let accent = effect_color(cadence_oracular_slot);
  let em = css_to_uv(vec2f(surface.z));
  let css = uv * surface.xy;
  let phrase_width = max(surface.x - 2.0 * cadence_oracular_padding, 1.0);
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));

  // Low motion fades the beam into one even lamplight; 0.2 is nearly still.
  let contrast = smoothstep(0.1, 1.0, motion);
  let lamp_x = cadence_oracular_padding + cadence_oracular_lamp_position(time * speed) * phrase_width;
  let beam_width = max(phrase_width * 0.09, surface.z * 0.9);
  let beam_distance = (css.x - lamp_x) / beam_width;
  let beam = exp(-0.5 * beam_distance * beam_distance) * contrast;
  // Paper rests dimmer so an ink-dark accent never smudges the letters.
  let rest_level = mix(0.07, 0.12, dark_page);
  let lamp_level = rest_level + (0.45 - rest_level) * beam + 0.1 * (1.0 - contrast);

  // Incense rises from the letters beneath it and thins out within 1.2 em.
  let height_above = cadence_oracular_padding - css.y;
  let rise_limit = min(surface.z * 1.2, cadence_oracular_padding - 8.0);
  let rising = smoothstep(-0.35 * surface.z, 0.1 * surface.z, height_above);
  let thinning = 1.0 - smoothstep(0.0, rise_limit, height_above);
  let source_depth = (clamp(height_above, 0.0, rise_limit) + 0.45 * surface.z) / max(surface.y, 1.0);
  let source = clamp(soft_mask(uv + vec2f(0.0, source_depth), em * 0.5) * 2.2, 0.0, 1.0);
  let drift = time * speed * 0.12 * clamp(motion, 0.0, 1.5);
  let smoke_point = css / max(surface.z, 1.0);
  let sway = 0.35 * ink_simplex(vec3f(smoke_point.x * 0.6, smoke_point.y * 0.5 + drift, drift * 0.3));
  let smoke = ink_fbm(vec3f(smoke_point.x * 1.1 + sway, (smoke_point.y + drift) * 0.45, drift * 0.4));
  let wisps = smoothstep(-0.15, 0.55, smoke);
  let haze_color = mix(base.rgb, accent, 0.55);
  out.behind = over(out.behind, haze_color, 0.10 * intensity * wisps * source * rising * thinning);

  // The lamp pools a little wider than the halo where it passes.
  out.behind = over(out.behind, accent, soft_mask(uv, em * 0.75) * 0.16 * beam * intensity);

  let halo = soft_mask(uv, em * 0.32);
  out.behind = over(out.behind, accent, halo * lamp_level * intensity);

  // The inscription's weight: a stone shadow on paper, a faint glow on dark.
  let weight = soft_mask(uv - vec2f(0.0, em.y * 0.04), em * 0.1);
  let weight_color = mix(base.rgb * 0.45, accent, dark_page);
  out.behind = over(out.behind, weight_color, weight * mix(0.18, 0.12, dark_page));

  let lamp_white = mix(accent, vec3f(1.0), 0.5);
  out.core_color = mix(out.core_color, lamp_white, 0.2 * beam * min(intensity, 1.5));
  return out;
}
`;
