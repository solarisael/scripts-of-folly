import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const pixel = params.font_size.div(params.size);
  const strength = params.intensity.mul(1.35);
  const offset = (x, y) => tsl.vec2(pixel.x.mul(x), pixel.y.mul(y));
  const dark = sample(uv.add(offset(0, 0.045))).a.mul(0.62);
  const light = sample(uv.sub(offset(0, 0.02))).a.mul(0.18);
  const halo = gaussian_alpha(
    tsl,
    sample,
    uv,
    pixel.mul(0.16).mul(strength),
  ).mul(0.38);
  let output = behind(tsl, rgba, tsl.vec3(0, 0, 0), dark);
  output = behind(tsl, output, tsl.vec3(1, 1, 1), light);
  return { uv, rgba: behind(tsl, output, params.base_color, halo) };
}
