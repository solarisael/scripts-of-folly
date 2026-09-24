import { behind } from "./composite.js";

function menu_sdr(tsl, color) {
  return tsl.mix(color, tsl.sRGBTransferOETF(color), 0.42);
}

export function build_effect(context) {
  const { tsl, uv, rgba, params, padding, color_override } = context;
  const { accent, base_color, size, font_size, time } = params;
  const aspect = size.x.div(size.y);
  const p = uv.sub(0.5).mul(tsl.vec2(aspect, 1));
  const drift = time.mul(0.07);
  // MaterialX Perlin is quieter than the menu's simplex field.
  const noise = (point) =>
    tsl.mx_fractal_noise_float(point, 3, 2, 0.5).div(1.75).mul(2);
  const current = tsl.vec2(
    noise(tsl.vec3(p.mul(1.65), drift)),
    noise(tsl.vec3(p.mul(1.65).add(tsl.vec2(13.7, 8.2)), drift.add(4.3))),
  );
  const warped = p.add(current.mul(0.12).mul(tsl.min(aspect, 1)));
  const body_signal = noise(
    tsl.vec3(warped.mul(3.4).add(current.mul(0.8)), drift.mul(0.6)),
  );
  const eddies = tsl
    .mx_noise_float(
      tsl.vec3(warped.mul(8).add(current.mul(2.2)), drift.mul(0.45)),
    )
    .mul(2);

  const half = size.mul(0.5);
  const margin = tsl.vec2(0.4, 0.9).mul(font_size).mul(params.intensity);
  const extent = tsl
    .max(half.sub(padding).add(margin), font_size.mul(0.55))
    .div(size.y);
  const normalized = tsl.abs(warped.div(extent));
  const radius = tsl.pow(
    tsl.pow(normalized.x, 3).add(tsl.pow(normalized.y, 3)),
    1 / 3,
  );
  const edge = radius.sub(1).add(body_signal.mul(0.18)).add(eddies.mul(0.035));
  const dense = tsl.float(1).sub(tsl.smoothstep(-0.035, 0.035, edge));
  const wash = tsl
    .float(1)
    .sub(tsl.smoothstep(-0.015, 0.2, edge.add(body_signal.mul(0.05))));
  const mist = tsl
    .float(1)
    .sub(tsl.smoothstep(-0.015, 0.55, edge.add(body_signal.mul(0.05))))
    .mul(
      tsl
        .smoothstep(0.34, 0.67, body_signal.mul(0.5).add(0.5))
        .mul(0.12)
        .add(0.08),
    );
  const pigment = tsl.max(
    tsl.clamp(dense.mul(0.98).add(wash.mul(0.22)), 0, 0.995),
    mist,
  );
  const wet_edge = tsl.max(wash.sub(dense), 0).mul(0.012);

  // The plume field and palette follow Solarisael's portal ink shaders.
  const shadow = tsl
    .vec3(0.001, 0.0015, 0.0025)
    .add(tsl.vec3(0.45, 0.55, 0.65).mul(wet_edge))
    .add(
      tsl.vec3(0.002, 0.003, 0.004).mul(tsl.clamp(body_signal.add(0.5), 0, 1)),
    );
  const radiance = tsl.mix(
    tsl.vec3(0.72, 0.7, 0.63),
    tsl.vec3(1, 0.98, 0.91),
    tsl.clamp(body_signal.add(0.5).add(wet_edge.mul(12)), 0, 1),
  );
  const dark_scheme = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );
  const palette = menu_sdr(tsl, tsl.mix(shadow, radiance, dark_scheme));
  const color = color_override ? accent : palette;
  const inverted_text = tsl.mix(
    tsl.vec3(1, 0.98, 0.91),
    tsl.vec3(0.002, 0.0025, 0.003),
    dark_scheme,
  );
  const text_color = tsl.mix(rgba.rgb, inverted_text, tsl.step(0.5, pigment));
  return {
    uv,
    rgba: behind(tsl, tsl.vec4(text_color, rgba.a), color, pigment),
  };
}
