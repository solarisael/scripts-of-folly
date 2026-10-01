import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { intensity, motion, speed, accent, base_color, size, font_size, time } =
    params;

  const unit = font_size.div(size);
  // Three's plane puts uv.y = 1 at the top; em.y grows downward like WGSL.
  const em = uv.sub(0.5).mul(tsl.vec2(1, -1)).mul(size).div(font_size);
  const frost = tsl.clamp(intensity, 0, 1.6);
  const reach = tsl.clamp(tsl.sqrt(tsl.max(intensity, 0)), 0.5, 2);
  const white = tsl.vec3(1, 1, 1);
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );

  // Paper frosts toward an accent-kissed white; dark pages toward a cool one.
  const tint = accent.div(tsl.max(tsl.max(accent.r, tsl.max(accent.g, accent.b)), 0.05));
  const veil_white = tsl.mix(
    tsl.mix(white, tint, 0.3),
    tsl.mix(tsl.vec3(0.84, 0.9, 1), tint, 0.22),
    dark_page,
  );

  // MaterialX Perlin stands in for ink_fbm; rescaled to a similar spread.
  const drift = time.mul(speed).mul(0.08);
  const curtain = tsl
    .mx_fractal_noise_float(
      tsl.vec3(
        em.x.mul(0.35).sub(drift.mul(0.6)),
        em.y.mul(1.1).sub(drift),
        drift.mul(0.7),
      ),
      3,
      2,
      0.5,
    )
    .div(1.75)
    .mul(2);
  const sway = tsl.clamp(motion.sub(0.2).div(0.8), 0, 1.5);
  const thickness = tsl.clamp(
    tsl
      .float(0.5)
      .sub(tsl.smoothstep(-0.32, 0.32, curtain))
      .mul(sway)
      .add(0.5),
    0,
    1,
  );

  // Washing dark ink toward paper costs contrast faster, so paper frosts lighter.
  const wash_low = tsl.mix(0.12, 0.15, dark_page);
  const wash_high = tsl.mix(0.4, 0.55, dark_page);
  const wash = tsl.clamp(
    frost.mul(tsl.mix(wash_low, wash_high, thickness)),
    0,
    tsl.mix(0.42, 0.8, dark_page),
  );
  const washed = tsl.mix(rgba.rgb, veil_white, wash);
  // Off-glyph texels carry no color, so the blurred copy washes the base.
  const washed_base = tsl.mix(base_color, veil_white, wash);

  const pool = tsl.clamp(
    gaussian_alpha(tsl, sample, uv, unit.mul(reach.mul(0.7))).mul(2.2),
    0,
    1,
  );
  const bloom = tsl.mix(
    tsl.mix(accent, tint, 0.5),
    tsl.mix(veil_white, tint, 0.6),
    dark_page,
  );

  // Light on glass: a soft diagonal band crossing the phrase every ~11 s.
  const half_width = size.x.div(font_size).mul(0.5).add(3);
  const sweep = time.mul(speed).div(11).fract();
  const band_center = tsl.mix(half_width.negate(), half_width, sweep);
  const band = tsl
    .float(1)
    .sub(
      tsl.smoothstep(0, 1.6, tsl.abs(em.x.add(em.y.mul(0.6)).sub(band_center))),
    );
  const sheen = band.mul(band);
  const sheen_color = tsl.mix(white, tint, 0.5);

  const milk = gaussian_alpha(
    tsl,
    sample,
    uv,
    unit.mul(tsl.mix(0.045, 0.12, thickness).mul(tsl.min(reach, 1.2))),
  )
    .mul(tsl.mix(0.35, 0.72, thickness))
    .mul(tsl.min(frost, 1))
    .mul(tsl.mix(0.8, 1, dark_page));

  const clarity = tsl.clamp(
    tsl.float(1).sub(frost.mul(tsl.mix(0.05, 0.34, thickness))),
    tsl.mix(0.72, 0.6, dark_page),
    1,
  );
  const glyph_alpha = rgba.a.mul(clarity);
  // Sheen lifts light ink toward white, but only tints dark ink on paper.
  const sheen_lift = tsl.mix(tint.mul(0.5), sheen_color, dark_page);
  const glyph_color = tsl.min(
    tsl.mix(washed, sheen_lift, sheen.mul(tsl.min(frost, 1)).mul(0.16)),
    white,
  );

  let output = behind(tsl, tsl.vec4(rgba.rgb, glyph_alpha), washed_base, milk);
  output = behind(
    tsl,
    output,
    sheen_color,
    sheen.mul(tsl.smoothstep(0.02, 0.4, pool)).mul(frost).mul(0.12),
  );
  output = behind(tsl, output, bloom, pool.mul(tsl.min(frost, 1.2)).mul(0.12));
  output = tsl.vec4(tsl.mix(output.rgb, glyph_color, glyph_alpha), output.a);

  return { uv, rgba: output };
}
