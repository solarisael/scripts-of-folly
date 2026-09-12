import { behind, gaussian_alpha } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { accent, size, font_size } = params;
  const strength = params.intensity.mul(1.55);
  const offset = (x, y) =>
    tsl.vec2(
      font_size.mul(tsl.float(x)).mul(strength).div(size.x),
      font_size.mul(tsl.float(y)).mul(strength).div(size.y),
    );
  const shadow = (x, y, weight) =>
    sample(uv.sub(offset(x, y))).a.mul(tsl.float(weight));
  const halo_radius = font_size.mul(0.24).mul(strength).div(size);
  const colored_halo = gaussian_alpha(tsl, sample, uv, halo_radius).mul(0.22);
  const core = tsl.vec4(rgba.rgb.mul(0.86), rgba.a);
  let output = behind(tsl, core, tsl.vec3(0, 0, 0), shadow(0.28, 0.3, 0.38));
  output = behind(tsl, output, tsl.vec3(0, 0, 0), shadow(0.16, 0.18, 0.64));
  output = behind(tsl, output, tsl.vec3(0, 0, 0), shadow(0.075, 0.09, 0.86));
  return { uv, rgba: behind(tsl, output, accent, colored_halo) };
}
