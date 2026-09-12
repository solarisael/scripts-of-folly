import { gaussian_rgba } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const radius = tsl.vec2(
    params.intensity.mul(0.075).mul(params.font_size).div(params.size.x),
    params.intensity.mul(0.075).mul(params.font_size).div(params.size.y),
  );
  const blurred = gaussian_rgba(tsl, sample, uv, radius);
  const color = tsl.mix(rgba.rgb, blurred.rgb, params.intensity.clamp(0, 1));
  const alpha = tsl.clamp(
    rgba.a
      .mul(tsl.float(1).sub(params.intensity.clamp(0, 1)))
      .add(blurred.a.mul(params.intensity.clamp(0, 1))),
    0,
    1,
  );
  return { uv, rgba: tsl.vec4(color, alpha) };
}
