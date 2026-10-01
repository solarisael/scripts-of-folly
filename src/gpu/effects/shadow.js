import { behind } from "./composite.js";

const hash21 = (tsl, point) =>
  tsl.fract(tsl.sin(tsl.dot(point, tsl.vec2(127.1, 311.7))).mul(43758.5453));

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params, padding = 0 } = context;
  const { accent, base_color, size, font_size, intensity, motion, time } = params;
  const speed = tsl.max(params.speed, 0.001);
  const em_uv = font_size.div(size);
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );

  // The lantern swings on its own clock, so neighbouring shadows drift apart.
  const sway_phase = hash21(tsl, size);
  const sway = tsl
    .sin(time.mul(speed).div(9).add(sway_phase).mul(6.2831853))
    .mul(motion)
    .mul(0.10471976);
  const angle = sway.add(0.78539816);
  // three.js uv grows upward, so "down" on screen is negative y here.
  const offset = tsl
    .vec2(tsl.cos(angle), tsl.sin(angle).negate())
    .mul(em_uv)
    .mul(intensity.mul(0.14));

  // Only a single line has one floor; taller blocks keep the shadow upright.
  const block_height = size.y.sub(padding * 2);
  const floor_squash = tsl.mix(
    tsl.float(0.9),
    tsl.float(1),
    tsl.smoothstep(font_size.mul(2.2), font_size.mul(2.8), block_height),
  );
  const pivot_y = font_size.mul(0.28).add(padding).div(size.y);

  const tap = (reach, blur_em, squash) => {
    const shifted = uv.sub(offset.mul(reach));
    const floor_uv = tsl.vec2(
      shifted.x,
      pivot_y.add(shifted.y.sub(pivot_y).div(squash)),
    );
    return sample(floor_uv, em_uv.mul(blur_em)).a;
  };

  const near = tap(0.4, 2 / 16, tsl.float(1));
  const middle = tap(0.75, 5 / 16, floor_squash);
  const far = tap(1.1, 12 / 16, floor_squash);

  // Paper gets a cool cast shadow; a dark page gets a pale ghost of the text standing behind it.
  const grey = tsl.vec3(tsl.dot(accent, tsl.vec3(0.21, 0.72, 0.07)));
  const paper_tint = tsl.mix(
    tsl.mix(tsl.mix(accent, grey, 0.35), tsl.vec3(0, 0, 0), 0.6),
    tsl.vec3(0.16, 0.2, 0.28),
    0.2,
  );
  const ghost_tint = tsl.mix(accent, grey, 0.2).mul(0.6);
  const tint = tsl.mix(paper_tint, ghost_tint, dark_page);
  const weights = tsl
    .mix(tsl.vec3(0.5, 0.3, 0.15), tsl.vec3(0.55, 0.45, 0.3), dark_page)
    .mul(intensity);

  let output = behind(tsl, rgba, tint, near.mul(weights.x));
  output = behind(tsl, output, tint, middle.mul(weights.y));
  output = behind(tsl, output, tint, far.mul(weights.z));
  return { uv, rgba: output };
}
