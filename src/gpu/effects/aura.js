import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const pixel = params.font_size.div(params.size);
  const strength = params.intensity;
  const alpha = gaussian_alpha(tsl, sample, uv, pixel.mul(0.24).mul(strength))
    .mul(0.42)
    .add(
      gaussian_alpha(tsl, sample, uv, pixel.mul(0.44).mul(strength)).mul(0.26),
    );
  return { uv, rgba: behind(tsl, rgba, params.accent, alpha) };
}
