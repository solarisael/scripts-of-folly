import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const phase = params.time.mul(params.speed).mul((2 * Math.PI) / 2.4);
  const pulse = tsl.sin(phase).mul(0.5).add(0.5);
  const lift = pulse
    .mul(-0.075)
    .mul(params.motion)
    .mul(params.font_size)
    .div(params.size.y);
  const scale = tsl.float(1).add(pulse.mul(0.02).mul(params.motion));
  const moved = uv.sub(0.5).div(scale).add(0.5).sub(tsl.vec2(0, lift));
  if (context.mode === "motion") return { uv: moved, rgba };
  const opacity = tsl
    .float(1)
    .sub(tsl.float(1).sub(pulse).mul(0.08).mul(params.motion));
  const core = tsl.vec4(rgba.rgb, rgba.a.mul(opacity));
  const strength = params.intensity;
  const near = gaussian_alpha(
    tsl,
    sample,
    uv,
    params.font_size.mul(0.16).mul(strength).div(params.size),
  ).mul(0.44);
  const far = gaussian_alpha(
    tsl,
    sample,
    uv,
    params.font_size.mul(0.3).mul(strength).div(params.size),
  ).mul(0.24);
  return { uv, rgba: behind(tsl, core, params.accent, near.add(far)) };
}
