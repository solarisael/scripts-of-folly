export function build_effect(context) {
  const { tsl, uv, params } = context;
  if (context.mode !== "motion") return { uv, rgba: context.rgba };
  const phase = params.time.mul(params.speed).mul((2 * Math.PI) / 2.8);
  const progress = tsl.mul(tsl.sub(1, tsl.cos(phase)), 0.5);
  const amplitude = params.font_size.mul(params.motion).mul(0.4);
  const offset = amplitude.mul(progress).div(params.size.y);
  return { uv: uv.add(tsl.vec2(0, offset)), rgba: context.rgba };
}
