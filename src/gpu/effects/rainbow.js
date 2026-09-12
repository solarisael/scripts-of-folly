export function build_effect(context) {
  const { tsl, uv, rgba, params } = context;
  const phase = uv.x.mul(6.283185307179586);
  const spectrum = tsl.vec3(
    tsl.cos(phase).mul(0.5).add(0.5),
    tsl.cos(phase.add(2.0943951023931953)).mul(0.5).add(0.5),
    tsl.cos(phase.add(4.1887902047863905)).mul(0.5).add(0.5),
  );
  const strength = tsl.clamp(params.intensity, 0, 1);
  return { uv, rgba: tsl.vec4(tsl.mix(rgba.rgb, spectrum, strength), rgba.a) };
}
