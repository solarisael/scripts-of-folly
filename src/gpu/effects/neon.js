import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { size, accent, base_color, font_size } = params;
  const strength = params.intensity;
  const pixel = font_size.div(size);
  const halo = (radius, weight) =>
    gaussian_alpha(
      tsl,
      sample,
      uv,
      pixel.mul(tsl.float(radius)).mul(strength),
    ).mul(tsl.float(weight));
  let output = behind(tsl, rgba, accent, halo(0.4, 0.36));
  output = behind(tsl, output, accent, halo(0.24, 0.52));
  output = behind(tsl, output, base_color, halo(0.12, 0.72));
  return { uv, rgba: output };
}
