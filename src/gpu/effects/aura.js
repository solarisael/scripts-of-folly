import { behind, over } from "./composite.js";

function hash21(tsl, point) {
  return tsl.fract(
    tsl.sin(tsl.dot(point, tsl.vec2(127.1, 311.7))).mul(43758.5453),
  );
}

// Same rising-cell scheme as the WGSL hook, unrolled because TSL has no cheap continue.
function mote_light(tsl, place_em, clock, em_px) {
  const cell_em = 0.3;
  const rise_em = 0.4;
  const home = tsl.floor(place_em.div(cell_em));
  const radius_px = tsl.max(tsl.float(1.3), em_px.mul(0.07));
  let light = tsl.float(0);

  for (let below = 0; below < 3; below += 1) {
    const cell = home.add(tsl.vec2(0, below));
    const life_clock = clock.add(
      hash21(tsl, cell.add(tsl.vec2(17.3, 5.1))).mul(7),
    );
    const cycle = tsl.floor(life_clock);
    const picked = tsl.step(
      hash21(tsl, cell.add(tsl.vec2(cycle.mul(3.17), cycle.mul(1.61)))),
      tsl.float(0.15),
    );
    const life = tsl.fract(life_clock);
    const jitter_x = hash21(tsl, cell.add(tsl.vec2(cycle, 41)));
    const jitter_y = hash21(tsl, cell.add(tsl.vec2(29, cycle)));
    const start_em = cell
      .add(tsl.vec2(jitter_x.mul(0.6).add(0.2), jitter_y.mul(0.7).add(0.3)))
      .mul(cell_em);
    const mote_em = start_em.sub(tsl.vec2(0, life.mul(rise_em)));
    const distance_px = tsl.length(place_em.sub(mote_em)).mul(em_px);
    const fade = tsl.sin(life.mul(Math.PI));
    light = light.add(
      tsl
        .exp(distance_px.mul(distance_px).div(radius_px.mul(radius_px)).negate())
        .mul(fade.mul(fade))
        .mul(picked),
    );
  }
  return light;
}

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { intensity, motion } = params;
  const speed = tsl.max(params.speed, tsl.float(0.001));
  const em_px = params.font_size;
  const em_uv = em_px.div(params.size);
  // TSL's uv.y points up; flipping it keeps the mote math identical to WGSL, where rising is -y.
  const place_em = uv.sub(0.5).mul(tsl.vec2(1, -1)).mul(params.size).div(em_px);
  const accent = params.accent;
  const white = tsl.vec3(1, 1, 1);
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(params.base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );
  const soft_mask = (radius_em) => sample(uv, em_uv.mul(radius_em)).a;

  // mx_fractal_noise_float stands in for ink_fbm; two octaves, same drift rate.
  const drift = params.time.mul(0.15).mul(speed);
  const currents = tsl
    .mx_fractal_noise_float(tsl.vec3(place_em.mul(0.7), drift), 2, 2.07, 0.5, 1)
    .div(1.5);
  const reach = soft_mask(intensity.mul(1.2));
  const field = tsl
    .smoothstep(0, 0.12, reach)
    .mul(motion.mul(currents).mul(0.35).add(1));
  const field_color = tsl.mix(
    accent,
    white,
    dark_page.mul(motion).mul(tsl.max(currents, 0)).mul(0.18),
  );
  let halo = tsl.vec4(
    field_color,
    tsl.clamp(field.mul(tsl.mix(0.035, 0.3, dark_page)), 0, 1),
  );

  // Body text has thinner strokes, so its contour needs a wider blur to stand clear of descenders.
  const contour_em = tsl.mix(0.75, 0.5, tsl.smoothstep(16, 28, em_px));
  const shimmer = tsl.mx_noise_float(
    tsl.vec3(
      place_em.x.mul(7),
      place_em.y.mul(1.5),
      params.time.mul(0.8).mul(speed),
    ),
  );
  const contour = soft_mask(contour_em).add(shimmer.mul(motion).mul(0.0015));
  const ring = tsl
    .smoothstep(0.066, 0.078, contour)
    .mul(tsl.float(1).sub(tsl.smoothstep(0.088, 0.102, contour)));
  const near_glyph = tsl.smoothstep(0.02, 0.12, soft_mask(0.18));
  const ring_color = tsl.mix(accent, white, dark_page.mul(0.4));
  const ring_strength = tsl.min(
    intensity.mul(0.35).mul(tsl.mix(1.2, 1.0, dark_page)),
    0.55,
  );
  const ring_alpha = ring
    .mul(tsl.float(1).sub(near_glyph))
    .mul(ring_strength)
    .mul(motion.mul(shimmer).mul(0.35).add(1));
  halo = over(tsl, halo, ring_color, ring_alpha);

  const lively = tsl.smoothstep(0.2, 0.45, motion);
  const shell = soft_mask(0.6);
  const band = tsl
    .smoothstep(0.015, 0.035, shell)
    .mul(tsl.float(1).sub(tsl.smoothstep(0.08, 0.12, shell)))
    .mul(tsl.float(1).sub(tsl.smoothstep(0.02, 0.05, sample(uv).a)));
  const motes = mote_light(tsl, place_em, params.time.mul(speed).div(3), em_px);
  const mote_color = tsl.mix(accent, white, dark_page.mul(0.65));
  const mote_strength = motion
    .mul(intensity)
    .mul(0.6)
    .mul(tsl.mix(0.3, 1.0, dark_page));
  halo = over(tsl, halo, mote_color, motes.mul(band).mul(lively).mul(mote_strength));

  return { uv, rgba: behind(tsl, rgba, halo.rgb, halo.a) };
}
