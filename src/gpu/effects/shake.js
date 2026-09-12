export function build_effect(context) {
  const { tsl, uv, params } = context;
  if (context.mode !== "motion") return { uv, rgba: context.rgba };
  const phase = params.time.mul(params.speed).div(0.7).fract();
  const segment = phase.mul(4).floor();
  const local = phase.mul(4).sub(segment);
  const stepped = local.mul(2).floor().div(2);
  const amplitude = params.font_size.mul(params.motion);
  const zero = tsl.vec2(0, 0);
  const first = tsl.vec2(0.1, -0.075).mul(amplitude);
  const second = tsl.vec2(-0.1, 0.075).mul(amplitude);
  const third = tsl.vec2(0.075, 0.1).mul(amplitude);
  const endpoint = tsl.mix(zero, first, stepped);
  const midpoint = tsl.mix(first, second, stepped);
  const latepoint = tsl.mix(second, third, stepped);
  const finish = tsl.mix(third, zero, stepped);
  const displacement = tsl.select(
    segment.lessThan(1),
    endpoint,
    tsl.select(
      segment.lessThan(2),
      midpoint,
      tsl.select(segment.lessThan(3), latepoint, finish),
    ),
  );
  return {
    uv: uv.sub(displacement.div(params.size)),
    rgba: context.rgba,
  };
}
