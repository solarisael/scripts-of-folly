import { WIDE_CAPTURE_PADDING } from "../blur_levels.js";

export const SHADOW_WGSL = String.raw`
const shadow_slot = 2u;

// A tap is the glyph pushed along the light ray, blurred by its distance
// from the letter. Far taps lie on the floor: squashed toward the baseline.
fn shadow_tap(uv: vec2f, offset: vec2f, reach: f32, blur_em: f32, squash: f32, pivot_y: f32) -> f32 {
  let shifted = uv - offset * reach;
  let floor_uv = vec2f(shifted.x, pivot_y + (shifted.y - pivot_y) / squash);
  return soft_mask(floor_uv, css_to_uv(vec2f(surface.z * blur_em)));
}

fn shadow_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[shadow_slot].x;
  let motion = settings[shadow_slot].y;
  let speed = max(settings[shadow_slot].z, 0.001);
  let em = surface.z;
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));

  // The lantern swings on its own clock, so neighbouring shadows drift apart.
  let sway_phase = hash21(vec2f(surface.x, surface.y));
  let sway = sin((time * speed / 9.0 + sway_phase) * 6.2831853) * motion * 0.10471976;
  let angle = 0.78539816 + sway;
  let offset = css_to_uv(vec2f(cos(angle), sin(angle)) * (em * 0.14 * intensity));

  // Only a single line has one floor; taller blocks keep the shadow upright.
  let block_height = surface.y - ${WIDE_CAPTURE_PADDING}.0 * 2.0;
  let floor_squash = mix(0.9, 1.0, smoothstep(em * 2.2, em * 2.8, block_height));
  let pivot_y = 1.0 - (${WIDE_CAPTURE_PADDING}.0 + em * 0.28) / max(surface.y, 1.0);

  let near = shadow_tap(uv, offset, 0.40, 2.0 / 16.0, 1.0, pivot_y);
  let middle = shadow_tap(uv, offset, 0.75, 5.0 / 16.0, floor_squash, pivot_y);
  let far = shadow_tap(uv, offset, 1.10, 12.0 / 16.0, floor_squash, pivot_y);

  // Paper gets a cool cast shadow; a dark page gets a pale ghost of the text standing behind it.
  let accent = effect_color(shadow_slot);
  let grey = vec3f(dot(accent, vec3f(0.21, 0.72, 0.07)));
  let paper_tint = mix(mix(mix(accent, grey, 0.35), vec3f(0.0), 0.6), vec3f(0.16, 0.2, 0.28), 0.2);
  let ghost_tint = mix(accent, grey, 0.2) * 0.6;
  let tint = mix(paper_tint, ghost_tint, dark_page);
  let weights = mix(vec3f(0.5, 0.3, 0.15), vec3f(0.55, 0.45, 0.3), dark_page) * intensity;

  out.behind = over(out.behind, tint, far * weights.z);
  out.behind = over(out.behind, tint, middle * weights.y);
  out.behind = over(out.behind, tint, near * weights.x);
  return out;
}
`;
