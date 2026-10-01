export const VEIL_WGSL = String.raw`
const veil_slot = 12u;

fn veil_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[veil_slot].x;
  let motion = settings[veil_slot].y;
  let speed = max(settings[veil_slot].z, 0.001);
  let accent = effect_color(veil_slot);
  let unit = css_to_uv(vec2f(surface.z, surface.z));
  let em = (uv - vec2f(0.5)) * surface.xy / max(surface.z, 1.0);
  let frost = clamp(intensity, 0.0, 1.6);
  let reach = clamp(sqrt(max(intensity, 0.0)), 0.5, 2.0);
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));

  // Paper frosts toward an accent-kissed white; dark pages toward a cool one.
  let tint = accent / max(max(accent.r, max(accent.g, accent.b)), 0.05);
  let veil_white = mix(mix(vec3f(1.0), tint, 0.3), mix(vec3f(0.84, 0.9, 1.0), tint, 0.22), dark_page);

  // Wide, low-y-frequency curtain; motion 0.2 flattens it to an even frost.
  let drift = time * speed * 0.08;
  let curtain = ink_fbm(vec3f(em.x * 0.35 - drift * 0.6, em.y * 1.1 - drift, drift * 0.7));
  let sway = clamp((motion - 0.2) / 0.8, 0.0, 1.5);
  let thickness = clamp(0.5 + (0.5 - smoothstep(-0.32, 0.32, curtain)) * sway, 0.0, 1.0);

  // Washing dark ink toward paper costs contrast faster, so paper frosts lighter.
  let wash_range = mix(vec2f(0.12, 0.4), vec2f(0.15, 0.55), dark_page);
  let wash = clamp(frost * mix(wash_range.x, wash_range.y, thickness), 0.0, mix(0.42, 0.8, dark_page));
  let washed = mix(out.core_color, veil_white, wash);

  let pool = clamp(soft_mask(uv, unit * (0.7 * reach)) * 2.2, 0.0, 1.0);
  let bloom = mix(mix(accent, tint, 0.5), mix(veil_white, tint, 0.6), dark_page);
  out.behind = over(out.behind, bloom, pool * 0.12 * min(frost, 1.2));

  // Light on glass: a soft diagonal band crossing the phrase every ~11 s.
  let half_width = surface.x / max(surface.z, 1.0) * 0.5 + 3.0;
  let sweep = fract(time * speed / 11.0);
  let band_center = mix(-half_width, half_width, sweep);
  let band = 1.0 - smoothstep(0.0, 1.6, abs(em.x + em.y * 0.6 - band_center));
  let sheen = band * band;
  let sheen_color = mix(vec3f(1.0), tint, 0.5);
  out.behind = over(out.behind, sheen_color, sheen * smoothstep(0.02, 0.4, pool) * 0.12 * frost);

  let milk_radius = unit * (mix(0.045, 0.12, thickness) * min(reach, 1.2));
  let milk = soft_mask(uv, milk_radius) * mix(0.35, 0.72, thickness) * min(frost, 1.0) * mix(0.8, 1.0, dark_page);
  out.behind = over(out.behind, washed, milk);

  // Sheen lifts light ink toward white, but only tints dark ink on paper.
  let sheen_lift = mix(tint * 0.5, sheen_color, dark_page);
  out.core_color = min(mix(washed, sheen_lift, sheen * 0.16 * min(frost, 1.0)), vec3f(1.0));
  let clarity_floor = mix(0.72, 0.6, dark_page);
  let clarity = 1.0 - frost * mix(0.05, 0.34, thickness);
  out.core_alpha *= clamp(clarity, clarity_floor, 1.0);
  return out;
}
`;
