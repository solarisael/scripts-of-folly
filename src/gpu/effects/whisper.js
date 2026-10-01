import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params, padding = 0 } = context;
  const { time, size, font_size, base_color, accent } = params;
  const intensity = tsl.max(params.intensity, 0);
  const motion = tsl.max(params.motion, 0);
  const speed = tsl.max(params.speed, 0.001);
  const em = font_size.div(size);
  const letters = size.x.div(font_size).mul(0.9);
  const fbm = (point) =>
    tsl.clamp(tsl.mx_fractal_noise_float(point, 3, 2, 0.5), -1, 1);

  const padding_x = tsl.float(padding).div(size.x);
  const phrase_x = uv.x
    .sub(padding_x)
    .div(tsl.max(tsl.float(1).sub(padding_x.mul(2)), 0.001));

  // One exhale every 5 s of tempo, crossing the phrase in 1.6 s; the wake behind it lingers and settles.
  const breath_reach = tsl.clamp(motion.sub(0.2).div(0.8), 0, 1.5);
  const breath_seconds = tsl.fract(time.mul(speed).div(5)).mul(5);
  const breath_center = breath_seconds.div(1.6).mul(1.5).sub(0.25);
  const breath_offset = phrase_x.sub(breath_center);
  const breath_band = tsl.exp(
    breath_offset.mul(breath_offset).div(0.11 * 0.11).negate(),
  );
  const breath_wake = tsl.select(
    breath_offset.lessThan(0),
    tsl.exp(breath_offset.div(0.28)),
    tsl.float(0),
  );

  const unevenness = fbm(
    tsl.vec3(
      uv.x.mul(letters),
      uv.y.mul(letters).mul(0.3),
      time.mul(speed).mul(0.05),
    ),
  )
    .mul(0.15)
    .add(0.85);
  const faded = tsl
    .clamp(tsl.float(0.62).sub(intensity.sub(1).mul(0.2125)), 0.42, 0.92)
    .mul(unevenness);
  const faintest = tsl.mix(
    tsl.float(0.4),
    tsl.float(0.37),
    tsl.clamp(intensity.sub(1), 0, 1),
  );
  const clearing = tsl.clamp(
    breath_reach.mul(breath_band.add(breath_wake.mul(0.25))),
    0,
    1,
  );
  const core_alpha = tsl.mix(tsl.max(faded, faintest), tsl.float(0.95), clearing);
  const core = tsl.vec4(rgba.rgb, rgba.a.mul(core_alpha));

  const drift = tsl
    .mx_noise_float(
      tsl.vec3(
        uv.x.mul(letters).mul(0.35),
        uv.y.mul(letters).mul(0.35),
        time.mul(speed).mul(0.06),
      ),
    )
    .mul(0.1)
    .mul(tsl.min(motion, 1).mul(0.5).add(0.5));
  const fog_uv = uv.add(tsl.vec2(drift.mul(em.x), 0));
  const condensation = tsl.clamp(
    fbm(
      tsl.vec3(
        uv.x.mul(letters).mul(0.4).add(7.3),
        uv.y.mul(letters).mul(0.4),
        time.mul(speed).mul(0.07).add(3.1),
      ),
    )
      .mul(0.4)
      .add(0.72),
    0.25,
    1.2,
  );
  const exhale = tsl
    .min(breath_reach, 1)
    .mul(tsl.clamp(breath_band.add(breath_wake.mul(0.6)), 0, 1))
    .add(1);
  const fog_amount = tsl
    .clamp(intensity, 0, 2.5)
    .mul(condensation)
    .mul(exhale);

  // Fog condenses toward the page itself: white paper, or the dark page behind light text.
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );
  const page = tsl.mix(tsl.vec3(1, 1, 1), tsl.vec3(0.018, 0.02, 0.026), dark_page);
  const fog_color = tsl.mix(tsl.mix(base_color, page, 0.5), accent, 0.25);
  const reach = intensity.mul(0.2).add(0.8);

  // Thin strokes blur to a weak mask; the lift gives the fog a body instead of a trace.
  const near = tsl
    .pow(gaussian_alpha(tsl, sample, fog_uv, em.mul(reach.mul(0.3))), 0.6)
    .mul(0.22)
    .mul(fog_amount);
  const far = tsl
    .pow(gaussian_alpha(tsl, sample, fog_uv, em.mul(reach.mul(0.6))), 0.6)
    .mul(0.12)
    .mul(fog_amount);

  const misted = behind(tsl, core, fog_color, near);
  return { uv, rgba: behind(tsl, misted, fog_color, far) };
}
