import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { accent, size, font_size } = params;
  const strength = params.intensity.mul(1.35);
  const pixel = font_size.div(size);
  const halo = (radius, weight) =>
    gaussian_alpha(
      tsl,
      sample,
      uv,
      pixel.mul(tsl.float(radius)).mul(strength),
    ).mul(tsl.float(weight));
  const alpha = halo(0.22, 0.58).add(halo(0.42, 0.36)).add(halo(0.72, 0.2));
  return { uv, rgba: behind(tsl, rgba, accent, alpha) };
}
