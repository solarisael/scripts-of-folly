import { behind, gaussian_alpha } from "./composite.js";

// One reading of the line: 6 s across, 1.5 s resting at the right,
// 3.5 s carried home, 1 s pause. Every turn is eased, so nothing wraps.
function lamp_position(tsl, beat) {
  const t = tsl.fract(beat.div(12)).mul(12);
  return tsl.smoothstep(0, 6, t).sub(tsl.smoothstep(7.5, 11, t));
}

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params, padding } = context;
  const { intensity, motion, accent, base_color, size, font_size, time } = params;
  const speed = tsl.max(params.speed, 0.001);
  const em = font_size.div(size);
  const css = uv.mul(size);
  const phrase_width = tsl.max(size.x.sub(padding * 2), 1);
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );

  // Low motion fades the beam into one even lamplight; 0.2 is nearly still.
  const contrast = tsl.smoothstep(0.1, 1, motion);
  const lamp_x = lamp_position(tsl, time.mul(speed))
    .mul(phrase_width)
    .add(padding);
  const beam_width = tsl.max(phrase_width.mul(0.09), font_size.mul(0.9));
  const beam_distance = css.x.sub(lamp_x).div(beam_width);
  const beam = tsl
    .exp(beam_distance.mul(beam_distance).mul(-0.5))
    .mul(contrast);
  // Paper rests dimmer so an ink-dark accent never smudges the letters.
  const rest_level = tsl.mix(0.07, 0.12, dark_page);
  const lamp_level = beam
    .mul(tsl.float(0.45).sub(rest_level))
    .add(rest_level)
    .add(tsl.float(1).sub(contrast).mul(0.1));

  // Incense rises from the letters beneath it and thins out within 1.2 em.
  // Three's uv.y = 1 is the top of the box, so "above" is larger y here.
  const height_above = css.y.sub(size.y.sub(padding));
  const rise_limit = tsl.min(font_size.mul(1.2), padding - 8);
  const rising = tsl.smoothstep(
    font_size.mul(-0.35),
    font_size.mul(0.1),
    height_above,
  );
  const thinning = tsl
    .float(1)
    .sub(tsl.smoothstep(0, rise_limit, height_above));
  const source_depth = tsl
    .clamp(height_above, 0, rise_limit)
    .add(font_size.mul(0.45))
    .div(size.y);
  const source = tsl.clamp(
    gaussian_alpha(
      tsl,
      sample,
      uv.sub(tsl.vec2(0, source_depth)),
      em.mul(0.5),
    ).mul(2.2),
    0,
    1,
  );
  const drift = time.mul(speed).mul(0.12).mul(tsl.clamp(motion, 0, 1.5));
  const smoke_point = css.div(font_size);
  const sway = tsl
    .mx_noise_float(
      tsl.vec3(
        smoke_point.x.mul(0.6),
        smoke_point.y.mul(0.5).sub(drift),
        drift.mul(0.3),
      ),
    )
    .mul(0.35);
  const smoke = tsl
    .mx_fractal_noise_float(
      tsl.vec3(
        smoke_point.x.mul(1.1).add(sway),
        smoke_point.y.sub(drift).mul(0.45),
        drift.mul(0.4),
      ),
      3,
      2,
      0.5,
    )
    .div(1.75)
    .mul(2);
  const wisps = tsl.smoothstep(-0.15, 0.55, smoke);
  const haze_color = tsl.mix(base_color, accent, 0.55);
  const haze_alpha = wisps
    .mul(source)
    .mul(rising)
    .mul(thinning)
    .mul(intensity)
    .mul(0.1);

  const halo_alpha = gaussian_alpha(tsl, sample, uv, em.mul(0.32))
    .mul(lamp_level)
    .mul(intensity);

  // The lamp pools a little wider than the halo where it passes.
  const pool_alpha = gaussian_alpha(tsl, sample, uv, em.mul(0.75))
    .mul(beam)
    .mul(intensity)
    .mul(0.16);

  // The inscription's weight: a stone shadow on paper, a faint glow on dark.
  const weight_alpha = gaussian_alpha(
    tsl,
    sample,
    uv.add(tsl.vec2(0, em.y.mul(0.04))),
    em.mul(0.1),
  ).mul(tsl.mix(0.18, 0.12, dark_page));
  const weight_color = tsl.mix(base_color.mul(0.45), accent, dark_page);

  const lamp_white = tsl.mix(accent, tsl.vec3(1, 1, 1), 0.5);
  const lift = beam.mul(tsl.min(intensity, 1.5)).mul(0.2);
  const lit_glyph = tsl.vec4(tsl.mix(rgba.rgb, lamp_white, lift), rgba.a);

  let output = behind(tsl, lit_glyph, weight_color, weight_alpha);
  output = behind(tsl, output, accent, halo_alpha);
  output = behind(tsl, output, accent, pool_alpha);
  output = behind(tsl, output, haze_color, haze_alpha);

  return { uv, rgba: output };
}
