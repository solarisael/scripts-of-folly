import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const radius = params.font_size.mul(0.32).div(params.size);
  const halo_alpha = gaussian_alpha(tsl, sample, uv, radius).mul(0.24);
  return { uv, rgba: behind(tsl, rgba, params.accent, halo_alpha) };
}
