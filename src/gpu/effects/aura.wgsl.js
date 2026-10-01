export const AURA_WGSL = String.raw`
const aura_slot = 8u;

// Two octaves of the house fbm give the field broad weather with a finer eddy riding on it.
fn aura_currents(place_em: vec2f, drift: f32) -> f32 {
  let broad = ink_fbm(vec3f(place_em * 0.7, drift));
  let eddy = ink_fbm(vec3f(place_em * 1.45 + vec2f(3.7, 1.9), drift * 1.3));
  return (broad + 0.5 * eddy) / 1.5;
}

fn aura_motes(place_em: vec2f, clock: f32, em_px: f32) -> f32 {
  let cell_em = 0.3;
  let rise_em = 0.4;
  let home = floor(place_em / cell_em);
  let radius_px = max(1.3, 0.07 * em_px);
  var light = 0.0;
  // A mote rises about 1.3 cells, so it can reach this pixel from the two cells below.
  for (var below = 0; below < 3; below += 1) {
    let cell = home + vec2f(0.0, f32(below));
    let life_clock = clock + hash21(cell + vec2f(17.3, 5.1)) * 7.0;
    let cycle = floor(life_clock);
    if (hash21(cell + vec2f(cycle * 3.17, cycle * 1.61)) > 0.15) {
      continue;
    }
    let life = fract(life_clock);
    let jitter = vec2f(hash21(cell + vec2f(cycle, 41.0)), hash21(cell + vec2f(29.0, cycle)));
    let start_em = (cell + vec2f(0.2 + 0.6 * jitter.x, 0.3 + 0.7 * jitter.y)) * cell_em;
    let mote_em = start_em - vec2f(0.0, rise_em * life);
    let distance_px = length(place_em - mote_em) * em_px;
    let fade = sin(3.14159265 * life);
    light += exp(-(distance_px * distance_px) / (radius_px * radius_px)) * fade * fade;
  }
  return light;
}

fn aura_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[aura_slot].x;
  let motion = settings[aura_slot].y;
  let speed = max(settings[aura_slot].z, 0.001);
  let em_px = max(surface.z, 1.0);
  let em_uv = css_to_uv(vec2f(em_px));
  let place_em = (uv - vec2f(0.5)) * surface.xy / em_px;
  let accent = effect_color(aura_slot);
  let white = vec3f(1.0);
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));

  // On paper a wide accent wash turns to mud, so the field thins there and the ring carries the look.
  let currents = aura_currents(place_em, time * 0.15 * speed);
  let reach = soft_mask(uv, em_uv * (1.2 * intensity));
  let field = smoothstep(0.0, 0.12, reach) * (1.0 + 0.35 * motion * currents);
  let field_color = mix(accent, white, 0.18 * dark_page * motion * max(currents, 0.0));
  out.behind = over(out.behind, field_color, field * mix(0.035, 0.3, dark_page));

  // Thin strokes blurred by half an em never reach 0.2, so the isoline that hugs a word sits near 0.08.
  // Body text has thinner strokes, so its contour needs a wider blur to stand clear of descenders.
  let contour_em = mix(0.75, 0.5, smoothstep(16.0, 28.0, em_px));
  let shimmer = ink_simplex(vec3f(place_em.x * 7.0, place_em.y * 1.5, time * 0.8 * speed));
  let contour = soft_mask(uv, em_uv * contour_em) + shimmer * 0.0015 * motion;
  let ring = smoothstep(0.066, 0.078, contour) * (1.0 - smoothstep(0.088, 0.102, contour));
  let near_glyph = smoothstep(0.02, 0.12, soft_mask(uv, em_uv * 0.18));
  let ring_color = mix(accent, white, 0.4 * dark_page);
  let ring_strength = min(0.35 * intensity * mix(1.2, 1.0, dark_page), 0.55);
  let ring_alpha = ring * (1.0 - near_glyph) * ring_strength * (1.0 + 0.35 * motion * shimmer);
  out.behind = over(out.behind, ring_color, ring_alpha);

  let lively = smoothstep(0.2, 0.45, motion);
  // Motes keep to the shell outside the letters so they never read as stray punctuation.
  let shell = soft_mask(uv, em_uv * 0.6);
  let band = smoothstep(0.015, 0.035, shell) * (1.0 - smoothstep(0.08, 0.12, shell)) * (1.0 - smoothstep(0.02, 0.05, sample_mask(uv)));
  if (lively * band > 0.0) {
    let motes = aura_motes(place_em, time * speed / 3.0, em_px);
    // On paper the motes are ink specks, so they stay faint enough to read as light rather than dust.
    let mote_color = mix(accent, white, 0.65 * dark_page);
    let mote_strength = 0.6 * motion * intensity * mix(0.3, 1.0, dark_page);
    out.behind = over(out.behind, mote_color, motes * band * lively * mote_strength);
  }
  return out;
}
`;
