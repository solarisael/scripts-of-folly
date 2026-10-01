import { behind } from "./composite.js";

const TAU = Math.PI * 2;

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const em = params.font_size.div(params.size);
  const pixel = tsl.vec2(1, 1).div(params.size);
  const intensity = params.intensity;
  const luma = tsl.vec3(0.21, 0.72, 0.07);
  const near_black = tsl.vec3(0.035, 0.03, 0.028);
  const warm_white = tsl.vec3(1.0, 0.93, 0.8);

  // Stone holds still; only motion above 0.4 lets the light swing, by 10 degrees at most.
  const drift = tsl
    .smoothstep(0.4, 0.6, params.motion)
    .mul(tsl.sin(params.time.mul(tsl.max(params.speed, 0.001)).mul(TAU / 24)));
  const angle = drift.mul(10).add(225).mul(Math.PI / 180);
  // Three's plane puts uv.y = 1 at the top, so up-left is (-x, +y) here, unlike the WGSL hook.
  const light_dir = tsl.vec2(tsl.cos(angle), tsl.sin(angle).negate());

  // Coverage the neighbour has and this pixel lacks: a thin band just outside the glyph edge.
  const center = sample(uv).a;
  const band = (offset) =>
    tsl.clamp(sample(uv.add(offset)).a.sub(center), 0, 1);

  const base = params.base_color;
  const base_luma = base.dot(luma);
  const dark_page = tsl.smoothstep(0.45, 0.75, base_luma);

  // The upper-left wall faces away from the light and the lower-right wall faces into it.
  const near_step = light_dir.mul(em).mul(intensity.mul(0.035));
  const far_step = near_step.mul(2);
  const band_gain = tsl.clamp(intensity.mul(0.45).add(0.55), 0.5, 1.5);
  const shadow_alpha = tsl.min(band_gain.mul(0.6), 0.9);
  // A light glyph swallows a dim glint, so dark pages light the lower-right wall harder.
  const light_alpha = tsl.min(tsl.mix(0.5, 0.75, dark_page).mul(band_gain), 0.9);

  const on_paper = tsl.mix(tsl.vec3(base_luma), base, 0.82).mul(0.86);
  const on_dark = tsl.mix(base, tsl.vec3(0.9, 0.95, 1.0), 0.3);
  let stone = tsl.mix(on_paper, on_dark, dark_page);

  const css = uv.mul(params.size);
  const speckle = tsl
    .fract(tsl.sin(tsl.floor(css).dot(tsl.vec2(127.1, 311.7))).mul(43758.5453))
    .sub(0.5);
  const mottle = tsl.mx_noise_float(
    tsl.vec3(css.div(tsl.max(params.font_size.mul(0.4), 1)), 3.7),
  );
  stone = stone.mul(speckle.mul(0.05).add(mottle.mul(0.015)).add(1));

  // The top-left lip shades the cavity floor and the far side catches light. Only the
  // lean of the blurred mask counts, so thin body strokes barely change and stay crisp.
  const blur = pixel.mul(5);
  const lip = sample(uv.add(light_dir.mul(em).mul(0.05)), blur).a;
  const lean = sample(uv, blur).a.sub(lip);
  const floor_shade = center.mul(tsl.clamp(lean.mul(3.5), -0.15, 0.5));
  stone = stone.mul(
    tsl.float(1).sub(floor_shade.mul(tsl.clamp(intensity, 0.2, 1.5))),
  );

  // Earlier effects may already sit in rgba; only the glyph itself turns to stone.
  const fill = tsl.mix(rgba.rgb, tsl.clamp(stone, 0, 1), tsl.clamp(center, 0, 1));
  let output = tsl.vec4(fill, rgba.a);
  output = behind(tsl, output, near_black, band(near_step.negate()).mul(shadow_alpha));
  output = behind(tsl, output, warm_white, band(near_step).mul(light_alpha));
  output = behind(tsl, output, near_black, band(far_step.negate()).mul(shadow_alpha.mul(0.5)));
  output = behind(tsl, output, warm_white, band(far_step).mul(light_alpha.mul(0.5)));
  output = behind(tsl, output, base, sample(uv, em.mul(0.16)).a.mul(0.12));

  return { uv, rgba: output };
}
