export function build_effect(context) {
  const { tsl, rgba, params } = context;
  const phase = params.time.mul(params.speed).div(1.8).fract();
  const ramp = (start, end) =>
    phase
      .sub(start)
      .div(end - start)
      .clamp(0, 1);
  const delta = (start, end, from, to) => ramp(start, end).mul(to - from);
  const dip = delta(0.04, 0.06, 0, 0.45)
    .add(delta(0.06, 0.08, 0.45, 0.05))
    .add(delta(0.08, 0.1, 0.05, 0.3))
    .add(delta(0.1, 0.46, 0.3, 0))
    .add(delta(0.46, 0.49, 0, 0.38))
    .add(delta(0.49, 0.52, 0.38, 0))
    .add(delta(0.52, 0.54, 0, 0.62))
    .add(delta(0.54, 0.86, 0.62, 0.08))
    .add(delta(0.86, 0.9, 0.08, 0.42))
    .add(delta(0.9, 1, 0.42, 0));
  const opacity = tsl.clamp(
    tsl.float(1).sub(dip.mul(params.motion).mul(1.25)),
    0,
    1,
  );
  return { uv: context.uv, rgba: rgba.mul(tsl.vec4(1, 1, 1, opacity)) };
}
