export const ETCH_WGSL = String.raw`
const etch_slot = 9u;
const etch_luma = vec3f(0.21, 0.72, 0.07);
const etch_near_black = vec3f(0.035, 0.03, 0.028);
const etch_warm_white = vec3f(1.0, 0.93, 0.8);

// CSS space grows downward, so 225 degrees points up-left, toward the light.
fn etch_light_dir(time: f32) -> vec2f {
  let motion = settings[etch_slot].y;
  let speed = max(settings[etch_slot].z, 0.001);
  // Stone holds still; only motion above 0.4 lets the light swing, by 10 degrees at most.
  let drift = smoothstep(0.4, 0.6, motion) * sin(time * speed * 6.2831853 / 24.0);
  let angle = radians(225.0 + 10.0 * drift);
  return vec2f(cos(angle), sin(angle));
}

// Coverage the neighbour has and this pixel lacks: a thin band just outside the glyph edge.
fn etch_band(uv: vec2f, offset: vec2f, center: f32) -> f32 {
  return clamp(sample_mask(uv + offset) - center, 0.0, 1.0);
}

fn etch_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[etch_slot].x;
  let em = surface.z;
  let light_dir = etch_light_dir(time);
  let center = sample_mask(uv);

  // The upper-left wall faces away from the light and the lower-right wall faces into it.
  let near_step = css_to_uv(light_dir * (0.035 * em * intensity));
  let far_step = near_step * 2.0;
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, etch_luma));
  let band_gain = clamp(0.55 + 0.45 * intensity, 0.5, 1.5);
  let shadow_alpha = min(0.6 * band_gain, 0.9);
  // A light glyph swallows a dim glint, so dark pages light the lower-right wall harder.
  let light_alpha = min(mix(0.5, 0.75, dark_page) * band_gain, 0.9);

  let dust = soft_mask(uv, css_to_uv(vec2f(em * 0.16)));
  out.behind = over(out.behind, base.rgb, dust * 0.12);
  out.behind = over(out.behind, etch_near_black, etch_band(uv, -far_step, center) * shadow_alpha * 0.5);
  out.behind = over(out.behind, etch_warm_white, etch_band(uv, far_step, center) * light_alpha * 0.5);
  out.behind = over(out.behind, etch_near_black, etch_band(uv, -near_step, center) * shadow_alpha);
  out.behind = over(out.behind, etch_warm_white, etch_band(uv, near_step, center) * light_alpha);

  let base_luma = dot(base.rgb, etch_luma);
  let on_paper = mix(vec3f(base_luma), base.rgb, 0.82) * 0.86;
  let on_dark = mix(base.rgb, vec3f(0.9, 0.95, 1.0), 0.3);
  var stone = mix(on_paper, on_dark, dark_page);

  let css = uv * surface.xy;
  let speckle = hash21(floor(css)) - 0.5;
  let mottle = ink_simplex(vec3f(css / max(em * 0.4, 1.0), 3.7));
  stone *= 1.0 + speckle * 0.05 + mottle * 0.015;

  // The top-left lip shades the cavity floor and the far side catches light. Only the
  // lean of the blurred mask counts, so thin body strokes barely change and stay crisp.
  let blur = css_to_uv(vec2f(5.0));
  let lip = soft_mask(uv + css_to_uv(light_dir * (0.05 * em)), blur);
  let lean = soft_mask(uv, blur) - lip;
  let floor_shade = center * clamp(lean * 3.5, -0.15, 0.5);
  stone *= 1.0 - floor_shade * clamp(intensity, 0.2, 1.5);

  out.core_color = clamp(stone, vec3f(0.0), vec3f(1.0));
  return out;
}
`;
