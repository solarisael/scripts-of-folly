export function build_effect(context) {
  const { tsl, uv, rgba, params } = context;
  const white = tsl.vec3(1, 1, 1);
  const start = tsl.mix(params.base_color, white, 0.14);
  const middle = tsl.mix(params.accent, white, 0.08);
  const end = tsl.mix(params.base_color, white, 0.1);
  const left = tsl.smoothstep(0, 0.5, uv.x);
  const right = tsl.smoothstep(0.5, 1, uv.x);
  const gradient = tsl.mix(
    tsl.mix(start, middle, left),
    tsl.mix(middle, end, right),
    right,
  );
  const strength = tsl.clamp(params.intensity, 0, 1);
  return {
    uv,
    rgba: tsl.vec4(tsl.mix(rgba.rgb, gradient, strength), rgba.a),
  };
}
