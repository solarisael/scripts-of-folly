import { over } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, params } = context;
  const stripe_size = params.font_size.mul(0.22).div(16);
  const stripe_phase = uv.y
    .mul(params.size.y)
    .add(
      params.time.mul(params.speed).mul(params.motion).mul(stripe_size).div(5),
    );
  const stripe = tsl
    .fract(stripe_phase.div(stripe_size))
    .greaterThan(0.19 / 0.22);
  const scan_alpha = tsl
    .float(0.14)
    .mul(params.intensity)
    .mul(tsl.select(stripe, 1, 0))
    .clamp(0, 1);
  return {
    uv,
    rgba: over(tsl, rgba, tsl.vec3(1, 1, 1), scan_alpha),
  };
}
