import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const strength = params.intensity.mul(1.45);
  const core_alpha = tsl.clamp(tsl.float(0.72).sub(strength.mul(0.08)), 0, 1);
  const pixel = params.font_size.div(params.size);
  const near = gaussian_alpha(
    tsl,
    sample,
    uv,
    pixel.mul(0.18).mul(strength),
  ).mul(0.08);
  const far = gaussian_alpha(
    tsl,
    sample,
    uv,
    pixel.mul(0.34).mul(strength),
  ).mul(0.04);
  const halo = tsl.clamp(near.add(far), 0, 1);
  const core = tsl.vec4(rgba.rgb, rgba.a.mul(core_alpha));
  return { uv, rgba: behind(tsl, core, params.accent, halo) };
}
