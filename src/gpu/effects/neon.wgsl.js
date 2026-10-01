import { WIDE_CAPTURE_PADDING } from "../blur_levels.js";

export const NEON_WGSL = String.raw`
const neon_slot = 1u;
const neon_padding_css = ${WIDE_CAPTURE_PADDING}.0;

// Raising the blurred mask pulls its falloff in toward the glyph so light clings to the strokes.
fn neon_halo(uv: vec2f, radius: vec2f) -> f32 {
  return pow(soft_mask(uv, radius), 1.6);
}

fn neon_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[neon_slot].x;
  let motion = settings[neon_slot].y;
  let speed = max(settings[neon_slot].z, 0.001);
  let accent = effect_color(neon_slot);
  let em = css_to_uv(vec2f(surface.z, surface.z));
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));
  let hum = 1.0 + (hash21(vec2f(floor(time * 24.0 * speed), 3.7)) * 2.0 - 1.0) * 0.03 * motion;

  // The letters upside down in the wet street, gone within 1 em. The line box leaves ~0.3 em under the
  // baseline, so the mirror sits that far above the box bottom rather than at the bottom itself.
  let baseline = 1.0 - (neon_padding_css + 0.3 * surface.z) / max(surface.y, 1.0);
  let below_css = (uv.y - baseline) * surface.y;
  let reflection_fade = step(0.0, below_css) * (1.0 - smoothstep(0.0, surface.z, below_css));
  let ripple = ink_simplex(vec3f(uv.y * 40.0, time * 0.6 * speed, 0.0)) * 0.004 * motion;
  let mirrored = vec2f(uv.x + ripple, baseline - (uv.y - baseline) / 1.5);
  let reflection = soft_mask(mirrored, css_to_uv(vec2f(5.0, 5.0))) * 0.1 * intensity * reflection_fade * hum;
  out.behind = over(out.behind, accent, reflection);

  // Reach grows with intensity at a third of its rate so a loud tube brightens rather than spreads.
  let reach = em * mix(1.0, intensity, 1.0 / 3.0);
  let gain = hum * clamp(intensity, 0.0, 1.6);
  out.behind = over(out.behind, accent, neon_halo(uv, reach * 0.26) * 0.12 * gain);
  out.behind = over(out.behind, accent, neon_halo(uv, reach * 0.14) * 0.45 * gain);
  out.behind = over(out.behind, mix(accent, vec3f(1.0), 0.15), neon_halo(uv, reach * 0.06) * 0.9 * gain);

  // White-hot core, accent glass at the rim. On paper the core keeps the ink so the letter stays legible.
  let rim = clamp((sample_mask(uv) - soft_mask(uv, em * 0.05)) * 2.5, 0.0, 1.0);
  let hot = mix(out.core_color, vec3f(1.0), 0.75 * dark_page);
  out.core_color = mix(hot, accent, rim);
  return out;
}
`;
