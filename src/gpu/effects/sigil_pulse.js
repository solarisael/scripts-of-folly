import { BLUR_RADII } from "../blur_levels.js";
import { behind, gaussian_alpha } from "./composite.js";

const WIDEST_BLUR = BLUR_RADII[BLUR_RADII.length - 1];

function attack_envelope(tsl, phase) {
  const rise = tsl.smoothstep(0, 0.12, phase);
  const fall = tsl
    .float(1)
    .sub(tsl.clamp(phase.sub(0.12).div(0.88), 0, 1));
  return rise.mul(fall).mul(fall);
}

// One expanding isoline of the blurred word. Thin strokes blur to a faint field, so the band sits low and sinks as the blur widens.
function ring_band(tsl, sample, uv, params, phase, reach_px) {
  // Water rings leave fast and slow down; an eased-in start would park the ring on the letters.
  const rest = tsl.float(1).sub(phase);
  const travel = tsl.float(1).sub(rest.mul(rest));
  const radius_px = tsl.mix(params.font_size.mul(0.25), reach_px, travel);
  const field = gaussian_alpha(tsl, sample, uv, tsl.vec2(radius_px).div(params.size));
  const threshold = tsl.mix(0.12, 0.035, travel);
  const half_band = threshold.div(6);
  const band = tsl
    .smoothstep(threshold.sub(half_band), threshold, field)
    .mul(tsl.float(1).sub(tsl.smoothstep(threshold, threshold.add(half_band), field)));
  const fade = tsl.pow(rest, 1.5).mul(tsl.smoothstep(0, 0.12, phase));
  return band.mul(fade);
}

export function build_effect(context) {
  const { tsl, uv, rgba, sample, params } = context;

  const phase = params.time.mul(params.speed).mul((2 * Math.PI) / 2.4);
  const pulse = tsl.sin(phase).mul(0.5).add(0.5);
  const lift = pulse
    .mul(-0.075)
    .mul(params.motion)
    .mul(params.font_size)
    .div(params.size.y);
  const scale = tsl.float(1).add(pulse.mul(0.02).mul(params.motion));
  const moved = uv.sub(0.5).div(scale).add(0.5).sub(tsl.vec2(0, lift));

  if (context.mode === "motion") return { uv: moved, rgba };

  // The lift above bottoms out a quarter period before its sine wraps; the beat lands there.
  const beat = params.time.mul(params.speed).div(2.4).add(0.25).fract();
  const accent = params.accent;
  // White ink vanishes on paper, so the answer only whitens on a dark page.
  const dark_page = tsl.smoothstep(
    0.45,
    0.75,
    tsl.dot(params.base_color, tsl.vec3(0.21, 0.72, 0.07)),
  );
  const accent_white = tsl.mix(accent, tsl.vec3(1, 1, 1), dark_page.mul(0.3));
  const intensity = params.intensity;
  const motion = params.motion;

  const flash = tsl.clamp(attack_envelope(tsl, beat).mul(0.5).mul(motion), 0, 1);
  const opacity = tsl
    .float(1)
    .sub(tsl.float(1).sub(pulse).mul(0.08).mul(motion));
  const core = tsl.vec4(
    tsl.mix(rgba.rgb, accent_white, flash),
    rgba.a.mul(opacity),
  );

  const reach_px = tsl.min(
    tsl.float(0.25).add(tsl.clamp(motion, 0, 1.5).mul(0.9)).mul(params.font_size),
    WIDEST_BLUR,
  );
  const leading = ring_band(tsl, sample, uv, params, beat, reach_px);
  const trailing = ring_band(tsl, sample, uv, params, beat.add(0.5).fract(), reach_px).mul(0.5);
  // Keep the wave out of letter gaps so body text never reads struck through.
  const clearance = tsl
    .float(1)
    .sub(
      tsl.smoothstep(
        0.03,
        0.15,
        gaussian_alpha(tsl, sample, uv, params.font_size.mul(0.2).div(params.size)),
      ),
    );
  const ring = tsl
    .max(leading, trailing)
    .mul(clearance)
    .mul(0.7)
    .mul(intensity)
    .mul(motion);

  const halo_near = gaussian_alpha(
    tsl,
    sample,
    uv,
    params.font_size.mul(0.16).div(params.size),
  ).mul(0.3).mul(intensity);
  const halo_far = gaussian_alpha(
    tsl,
    sample,
    uv,
    params.font_size.mul(0.3).div(params.size),
  ).mul(0.15).mul(intensity);

  let output = behind(tsl, core, accent_white, ring);
  output = behind(tsl, output, accent, halo_near);
  output = behind(tsl, output, accent, halo_far);
  return { uv, rgba: output };
}
