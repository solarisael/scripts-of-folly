import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { intensity, motion, base_color, size, font_size } = params;

  const tempo = params.time.mul(params.speed);
  const em = font_size.div(size);
  const white = tsl.vec3(1, 1, 1);
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );

  // Two phrases on one page share the clock, so each takes its own phase from its size.
  const seed = tsl
    .sin(tsl.dot(size, tsl.vec2(127.1, 311.7)))
    .mul(43758.5453)
    .fract();
  const breath = tsl
    .sin(tempo.mul((2 * Math.PI) / 4.2).add(seed.mul(2 * Math.PI)))
    .mul(motion.mul(0.15))
    .add(1);
  const flame_field = tsl
    .mx_fractal_noise_float(
      tsl.vec3(
        uv.x.mul(2.6).sub(tempo.mul(0.05)),
        uv.y.mul(0.5),
        tempo.mul(0.07).add(seed.mul(17)),
      ),
      3,
      2,
      0.5,
    )
    .div(1.75)
    .mul(2);
  const flame = tsl.clamp(flame_field.mul(motion.mul(0.45)).add(1), 0.4, 1.6);

  // Heat rises: uv.y points up here, so reading below the pixel lifts the widest halo.
  const shimmer = tsl.mx_noise_float(
    tsl.vec3(
      uv.x.mul(3),
      uv.y.mul(2).sub(tempo.mul(0.6)),
      tempo.mul(0.3).add(seed.mul(5)),
    ),
  );
  const heat_offset = tsl
    .vec2(shimmer.mul(0.03).mul(motion), motion.mul(-0.06))
    .mul(em);

  // With no authored color the accent is the ink itself, which on paper is a shadow, not light.
  const ink_accent = tsl
    .float(1)
    .sub(tsl.smoothstep(0.02, 0.08, tsl.distance(params.accent, base_color)));
  const accent = tsl.mix(
    params.accent,
    tsl.vec3(1, 0.64, 0.28),
    ink_accent.mul(tsl.float(1).sub(dark_page)),
  );
  const luma = tsl.dot(accent, tsl.vec3(0.2126, 0.7152, 0.0722));
  const paper_tint = tsl.clamp(
    tsl.mix(tsl.vec3(luma, luma, luma), accent, 1.3).mul(0.94),
    0,
    1,
  );
  const core_color = tsl.mix(accent, white, tsl.mix(0.22, 0.35, dark_page));
  const outer_color = tsl.mix(paper_tint, accent, dark_page);
  const outer_reach = tsl.mix(0.66, 1.05, dark_page);

  const halo = (at, radius) =>
    gaussian_alpha(tsl, sample, at, em.mul(radius).mul(intensity));

  const outer = halo(uv.add(heat_offset), outer_reach)
    .mul(0.3)
    .mul(intensity)
    .mul(breath)
    .mul(flame);
  const middle = halo(uv, 0.45)
    .mul(tsl.mix(0.4, 0.36, dark_page))
    .mul(intensity)
    .mul(tsl.mix(1, flame, 0.7));
  const core = halo(uv, 0.2)
    .mul(0.5)
    .mul(intensity)
    .mul(tsl.mix(1, flame, 0.35));

  let output = behind(tsl, rgba, core_color, core);
  output = behind(tsl, output, outer_color, middle);
  output = behind(tsl, output, outer_color, outer);
  return { uv, rgba: output };
}
