import { WIDE_CAPTURE_PADDING } from "../blur_levels.js";
import { behind, gaussian_alpha } from "./composite.js";

function hash21(tsl, point) {
  return tsl.fract(tsl.sin(tsl.dot(point, tsl.vec2(127.1, 311.7))).mul(43758.5453));
}

// Still water at motion 0.2; the river is fully awake by 1.
function live_of(tsl, motion) {
  return tsl.clamp(motion.sub(0.2).div(0.8), 0, 1.5);
}

// The slow sink: 0 at the surface, 1 at the bottom, once every 7 s of tempo.
function sink_of(tsl, time, motion, speed) {
  const gate = tsl.smoothstep(0.4, 0.55, motion);
  return gate.mul(tsl.float(0.5).sub(tsl.cos(time.mul(speed).mul((2 * Math.PI) / 7)).mul(0.5)));
}

// Three drops share a 3.6 s beat, a third apart, and each lands somewhere new on the phrase.
// A ring leaves fast and slows like water. Push is radial at unit amplitude in em; crest is the brightest ridge here.
function rings_of(tsl, em, beat, size, font_size) {
  const reach = tsl.max(
    size.sub(WIDE_CAPTURE_PADDING * 2).mul(0.5).div(font_size),
    tsl.vec2(0.3, 0.3),
  );
  let push = tsl.vec2(0, 0);
  let crest = tsl.float(0);
  for (let lane = 0; lane < 3; lane += 1) {
    const cycle = beat.add(lane / 3);
    const phase = tsl.fract(cycle);
    const seed = tsl.mod(tsl.floor(cycle), 61).mul(1.618).add(lane);
    const landing = tsl
      .vec2(
        hash21(tsl, tsl.vec2(size.x.add(seed), size.y)),
        hash21(tsl, tsl.vec2(size.y.add(seed), size.x.add(7))),
      )
      .mul(2)
      .sub(1);
    const center = landing.mul(reach).mul(0.8);
    const rest = tsl.float(1).sub(phase);
    const radius = tsl.mix(0.12, 2.4, tsl.float(1).sub(rest.mul(rest)));
    const offset = em.sub(center);
    const distance = tsl.length(offset);
    const band = distance.sub(radius).div(0.25);
    const shape = tsl.sin(distance.sub(radius).mul(16.5)).mul(tsl.exp(band.mul(band).negate()));
    const fade = tsl.pow(rest, 1.5).mul(tsl.smoothstep(0, 0.06, phase));
    push = push.add(offset.div(tsl.max(distance, 0.001)).mul(shape).mul(fade));
    crest = tsl.max(crest, tsl.smoothstep(0.7, 0.98, tsl.abs(shape)).mul(fade));
  }
  return { push, crest };
}

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;
  const { size, font_size, time, accent, base_color } = params;
  const intensity = tsl.max(params.intensity, 0);
  const motion = tsl.max(params.motion, 0);
  const speed = tsl.max(params.speed, 0.001);
  const live = live_of(tsl, motion);
  // Three's uv.y = 1 is the top; em.y grows downward like WGSL.
  const flip = tsl.vec2(1, -1);
  const em = uv.sub(0.5).mul(flip).mul(size).div(font_size);
  const beat = time.mul(speed).div(3.6);

  if (context.mode === "motion") {
    const rings = rings_of(tsl, em, beat, size, font_size)
      .push.mul(0.045)
      .mul(live)
      .mul(tsl.clamp(intensity, 0.5, 1.5));
    // MaterialX fractal noise stands in for ink_fbm, rescaled to a similar spread.
    const drift = time.mul(speed).mul(0.2);
    const fbm = (point) => tsl.mx_fractal_noise_float(point, 3, 2, 0.5).div(1.75).mul(2);
    const sway = tsl
      .vec2(
        fbm(tsl.vec3(em.mul(0.5).add(tsl.vec2(drift, 0)), drift.mul(0.5))),
        fbm(
          tsl.vec3(
            em.mul(0.5).add(tsl.vec2(13.7, tsl.float(5.1).sub(drift.mul(0.6)))),
            drift.mul(0.5).add(3),
          ),
        ),
      )
      .mul(0.015)
      .mul(live);

    // Past 0.07 em the strokes of body text start to tear.
    const bend = rings.add(sway);
    const held = bend.mul(tsl.min(1, tsl.float(0.07).div(tsl.max(tsl.length(bend), 0.0001))));
    const sink = sink_of(tsl, time, motion, speed).mul(0.05).mul(tsl.min(motion, 1.5));

    // Reading from above the pixel draws the glyph lower.
    const shift = tsl.vec2(held.x, held.y.add(sink)).mul(flip).mul(font_size).div(size);
    return { uv: uv.sub(shift), rgba };
  }

  const depth = tsl.min(intensity, 1.5);
  const dark_page = tsl.smoothstep(0.45, 0.75, tsl.dot(base_color, tsl.vec3(0.21, 0.72, 0.07)));
  const sink = sink_of(tsl, time, motion, speed);
  const unit = font_size.div(size);

  // With no authored color the accent is the ink itself, so the river brings its own.
  const authored = tsl.smoothstep(0.02, 0.08, tsl.distance(accent, base_color));
  const river = tsl.mix(tsl.vec3(0.12, 0.33, 0.4), tsl.vec3(0.55, 0.82, 0.88), dark_page);
  const water = tsl.mix(river, accent, authored);
  // Warm light ink cancels a 0.35 teal to grey, so dark pages take a little more.
  const steep = tsl.clamp(
    tsl.mix(0.3, 0.4, dark_page).mul(depth).mul(sink.mul(0.3).add(1)),
    0,
    0.8,
  );
  const tinted = tsl.mix(rgba.rgb, water, steep);
  // Off-glyph texels carry no color, so the soft copy tints the text color itself, bluer than the word.
  const deep = tsl.mix(base_color, water, tsl.clamp(steep.mul(1.6), 0, 0.9));
  // The word seen through depth: a soft copy beneath the sharp one, softest at the bottom of the sink.
  const blur_em = intensity.mul(0.03).add(0.01).mul(sink.mul(0.35).add(1));
  const haze = gaussian_alpha(tsl, sample, uv, unit.mul(blur_em));

  // Ring crests catch the light, but only within reach of the words.
  const crest = rings_of(tsl, em, beat, size, font_size).crest;
  const near = tsl.smoothstep(0.02, 0.25, gaussian_alpha(tsl, sample, uv, unit.mul(0.4)));
  const glint = tsl.mix(water, tsl.mix(water, tsl.vec3(1, 1, 1), 0.55), dark_page);

  // Caustics wander over the strokes; at motion 0.2 they hold still.
  // MaterialX Perlin runs narrower than ink_simplex, so it is widened before the threshold.
  const flow = time.mul(speed).mul(0.3).mul(live);
  const cell = em.div(0.35);
  const noise = (point) => tsl.mx_noise_float(point).mul(1.35);
  const light = tsl.max(
    noise(tsl.vec3(cell.x.add(flow.mul(0.7)), cell.y.sub(flow.mul(0.4)), flow)),
    noise(
      tsl.vec3(
        cell.mul(1.3).add(tsl.vec2(tsl.float(7.1).sub(flow.mul(0.5)), flow.mul(0.3).add(2.9))),
        flow.mul(1.2).add(4),
      ),
    ),
  );
  const fleck = tsl.smoothstep(0.55, 0.85, light);
  const caustic_color = tsl.vec3(0.86, 0.97, 1);
  const shimmer = fleck
    .mul(sample(uv).a)
    .mul(tsl.mix(0.12, 0.3, dark_page))
    .mul(tsl.min(intensity, 2))
    .mul(tsl.min(motion, 1.5).mul(0.5).add(0.5));

  // Deeper is fainter, but the letterform keeps at least 0.6 of its ink. On a dark page a passing
  // caustic brings the faded ink back to full, which is what makes light ink read as lit.
  const clarity = tsl.mix(
    tsl.clamp(tsl.float(1).sub(intensity.mul(0.25).mul(sink.mul(0.25).add(1))), 0.6, 1),
    1,
    tsl.clamp(shimmer.mul(dark_page).mul(2.5), 0, 1),
  );
  // Light ink barely moves toward pale light, so dark pages lift it harder; paper keeps ink as ink.
  const glyph_color = tsl.mix(
    tinted,
    caustic_color,
    tsl.clamp(shimmer.mul(tsl.mix(0.8, 2, dark_page)), 0, 0.7),
  );

  let output = tsl.vec4(glyph_color, rgba.a.mul(clarity));
  output = behind(tsl, output, caustic_color, shimmer);
  output = behind(tsl, output, glint, crest.mul(near).mul(0.15).mul(live));
  output = behind(tsl, output, deep, haze.mul(0.6).mul(depth));

  return { uv, rgba: output };
}
