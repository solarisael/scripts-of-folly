import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const pixel = params.font_size.div(params.size);
  const strength = params.intensity.mul(1.45);
  const inner = gaussian_alpha(
    tsl,
    sample,
    uv,
    pixel.mul(0.24).mul(strength),
  ).mul(0.44);
  const middle = gaussian_alpha(
    tsl,
    sample,
    uv,
    pixel.mul(0.52).mul(strength),
  ).mul(0.24);
  const outer = gaussian_alpha(
    tsl,
    sample,
    uv,
    pixel.mul(0.85).mul(strength),
  ).mul(0.14);
  const halo_alpha = inner.add(middle).add(outer);
  const halo_color = params.accent
    .mul(inner.add(middle))
    .add(tsl.vec3(1, 1, 1).mul(outer));
  const white_mix = tsl.clamp(tsl.float(0.22).add(strength.mul(0.08)), 0, 1);
  const veiled = params.base_color
    .mul(tsl.float(1).sub(white_mix))
    .add(tsl.vec3(1, 1, 1).mul(white_mix));
  const wash = tsl.clamp(
    tsl.float(1).sub(tsl.abs(uv.x.sub(0.48)).mul(2.08)),
    0,
    1,
  );
  const text_color = veiled.add(
    params.accent.mul(wash).mul(strength.mul(0.08)),
  );
  let output = behind(tsl, rgba, halo_color, halo_alpha);
  output = tsl.vec4(tsl.mix(output.rgb, text_color, rgba.a), output.a);
  return { uv, rgba: output };
}
