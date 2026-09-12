export function build_effect(context) {
  const { tsl, uv, params } = context;
  if (context.mode !== "motion") return { uv, rgba: context.rgba };
  const phase = params.time.mul(params.speed).div(1.3).fract();
  const segment = phase.mul(4).floor();
  const local = phase.mul(4).sub(segment);
  const eased = tsl.smoothstep(0, 1, local);
  const first = tsl.vec2(0, -0.075);
  const second = tsl.vec2(0, 0.075);
  const third = tsl.vec2(0, -0.0375);
  const zero = tsl.vec2(0, 0);
  const y = tsl
    .select(
      segment.lessThan(1),
      tsl.mix(zero.y, first.y, eased),
      tsl.select(
        segment.lessThan(2),
        tsl.mix(first.y, second.y, eased),
        tsl.select(
          segment.lessThan(3),
          tsl.mix(second.y, third.y, eased),
          tsl.mix(third.y, zero.y, eased),
        ),
      ),
    )
    .mul(params.font_size)
    .mul(params.motion);
  const rotation = tsl
    .select(
      segment.lessThan(1),
      tsl.mix(0, -0.55, eased),
      tsl.select(
        segment.lessThan(2),
        tsl.mix(-0.55, 0.55, eased),
        tsl.select(
          segment.lessThan(3),
          tsl.mix(0.55, 0.35, eased),
          tsl.mix(0.35, 0, eased),
        ),
      ),
    )
    .mul(params.motion)
    .mul(Math.PI / 180);
  const cosine = tsl.cos(rotation);
  const sine = tsl.sin(rotation);
  const local_uv = uv.sub(0.5);
  const rotated = tsl
    .vec2(
      local_uv.x.mul(cosine).sub(local_uv.y.mul(sine)),
      local_uv.x.mul(sine).add(local_uv.y.mul(cosine)),
    )
    .add(0.5);
  return {
    uv: rotated.sub(tsl.vec2(0, y.div(params.size.y))),
    rgba: context.rgba,
  };
}
