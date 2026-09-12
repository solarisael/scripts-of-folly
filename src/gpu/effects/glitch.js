import { behind } from "./composite.js";

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const phase = params.time.mul(params.speed).div(1.05).fract();
  const x_em = tsl.select(
    phase.lessThan(0.2),
    0,
    tsl.select(
      phase.lessThan(0.4),
      -0.075,
      tsl.select(
        phase.lessThan(0.6),
        0.075,
        tsl.select(phase.lessThan(0.8), -0.04, 0.06),
      ),
    ),
  );
  const y_em = tsl.select(
    phase.lessThan(0.2),
    0,
    tsl.select(
      phase.lessThan(0.4),
      0.04,
      tsl.select(
        phase.lessThan(0.6),
        -0.04,
        tsl.select(phase.lessThan(0.8), -0.06, 0.04),
      ),
    ),
  );
  const offset = tsl.vec2(
    x_em.mul(params.font_size).mul(params.motion).div(params.size.x),
    y_em.mul(params.font_size).mul(params.motion).div(params.size.y),
  );
  if (context.mode === "motion") return { uv: uv.add(offset), rgba };
  const horizontal = params.font_size.mul(0.04).div(params.size.x);
  const red_alpha = sample(uv.add(tsl.vec2(horizontal, 0))).a.mul(0.64);
  const blue_alpha = sample(uv.sub(tsl.vec2(horizontal, 0))).a.mul(0.64);
  let output = behind(tsl, rgba, tsl.vec3(1, 80 / 255, 130 / 255), red_alpha);
  output = behind(tsl, output, tsl.vec3(80 / 255, 200 / 255, 1), blue_alpha);
  return { uv, rgba: output };
}
