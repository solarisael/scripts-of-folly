import { behind, gaussian_alpha } from "./composite.js";

function hash21(tsl, point) {
  return tsl.fract(tsl.sin(tsl.dot(point, tsl.vec2(127.1, 311.7))).mul(43758.5453));
}

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params, padding = 0 } = context;
  const { size, accent, base_color, font_size, time, motion, intensity } = params;
  const speed = tsl.max(params.speed, 0.001);
  const white = tsl.vec3(1, 1, 1);
  const em = font_size.div(size);
  const dark_page = tsl.smoothstep(0.45, 0.75, tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)));
  const hum = hash21(tsl, tsl.vec2(tsl.floor(time.mul(24).mul(speed)), 3.7))
    .mul(2)
    .sub(1)
    .mul(0.03)
    .mul(motion)
    .add(1);

  // Raising the blurred mask pulls its falloff in toward the glyph so light clings to the strokes.
  // Reach grows with intensity at a third of its rate so a loud tube brightens rather than spreads.
  const reach = em.mul(tsl.mix(1, intensity, 1 / 3));
  const gain = hum.mul(tsl.clamp(intensity, 0, 1.6));
  const halo = (radius, weight) =>
    tsl.pow(gaussian_alpha(tsl, sample, uv, reach.mul(radius)), 1.6).mul(weight).mul(gain);

  // The letters upside down in the wet street, gone within 1 em. The line box leaves ~0.3 em under the
  // baseline, so the mirror sits that far above the box bottom. TSL uv runs bottom-up.
  const baseline = font_size.mul(0.3).add(padding).div(size.y);
  const below_css = baseline.sub(uv.y).mul(size.y);
  const reflection_fade = tsl
    .step(0, below_css)
    .mul(tsl.float(1).sub(tsl.smoothstep(0, font_size, below_css)));
  const ripple = tsl
    .mx_noise_float(tsl.vec3(uv.y.mul(40), time.mul(0.6).mul(speed), 0))
    .mul(0.004)
    .mul(motion);
  const mirrored = tsl.vec2(uv.x.add(ripple), baseline.add(below_css.div(size.y).div(1.5)));
  const reflection = gaussian_alpha(tsl, sample, mirrored, tsl.vec2(5, 5).div(size))
    .mul(0.1)
    .mul(intensity)
    .mul(reflection_fade)
    .mul(hum);

  // White-hot core, accent glass at the rim. On paper the core keeps the ink so the letter stays legible.
  const rim = tsl.clamp(
    rgba.a.sub(gaussian_alpha(tsl, sample, uv, em.mul(0.05))).mul(2.5),
    0,
    1,
  );
  const hot = tsl.mix(rgba.rgb, white, dark_page.mul(0.75));
  let output = tsl.vec4(tsl.mix(hot, accent, rim), rgba.a);

  output = behind(tsl, output, tsl.mix(accent, white, 0.15), halo(0.06, 0.9));
  output = behind(tsl, output, accent, halo(0.14, 0.45));
  output = behind(tsl, output, accent, halo(0.26, 0.12));
  output = behind(tsl, output, accent, reflection);

  return { uv, rgba: output };
}
