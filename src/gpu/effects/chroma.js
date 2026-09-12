import { behind } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const horizontal = params.intensity
    .mul(params.font_size)
    .mul(0.05)
    .div(params.size.x);
  const red_alpha = sample(uv.add(tsl.vec2(horizontal, 0))).a.mul(0.66);
  const blue_alpha = sample(uv.sub(tsl.vec2(horizontal, 0))).a.mul(0.66);
  let output = behind(tsl, rgba, tsl.vec3(1, 80 / 255, 130 / 255), red_alpha);
  output = behind(tsl, output, tsl.vec3(80 / 255, 200 / 255, 1), blue_alpha);
  return { uv, rgba: output };
}
