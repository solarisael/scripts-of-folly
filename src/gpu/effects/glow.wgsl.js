export const GLOW_WGSL = String.raw`
const glow_slot = 0u;

// On paper a pale accent turns to grey smudge, so it gets a little more chroma.
fn glow_paper_tint(color: vec3f) -> vec3f {
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3f(luma), color, 1.3) * 0.94, vec3f(0.0), vec3f(1.0));
}

fn glow_shade(uv: vec2f, time: f32, ink: Ink) -> Ink {
  var out = ink;
  let intensity = settings[glow_slot].x;
  let motion = settings[glow_slot].y;
  let tempo = time * settings[glow_slot].z;
  let em = css_to_uv(vec2f(surface.z, surface.z));
  let dark_page = smoothstep(0.45, 0.75, dot(base.rgb, vec3f(0.21, 0.72, 0.07)));

  // Two phrases on one page share the clock, so each takes its own phase from its size.
  let seed = hash21(vec2f(surface.x, surface.y));
  let breath = 1.0 + 0.15 * motion * sin(tempo * 6.2831853 / 4.2 + seed * 6.2831853);
  let flame_field = ink_fbm(vec3f(uv.x * 2.6 - tempo * 0.05, uv.y * 0.5, tempo * 0.07 + seed * 17.0));
  let flame = clamp(1.0 + 0.45 * motion * flame_field, 0.4, 1.6);

  // Heat rises: the widest halo is read from below the pixel, so it sits higher than the glyph.
  let shimmer = ink_simplex(vec3f(uv.x * 3.0, uv.y * 2.0 + tempo * 0.6, tempo * 0.3 + seed * 5.0));
  let heat_offset = vec2f(shimmer * 0.03 * motion, 0.06 * motion) * em;

  // With no authored color the accent is the ink itself, which on paper is a shadow, not light.
  let ink_accent = 1.0 - smoothstep(0.02, 0.08, distance(effect_color(glow_slot), base.rgb));
  let accent = mix(effect_color(glow_slot), vec3f(1.0, 0.64, 0.28), ink_accent * (1.0 - dark_page));
  let core_color = mix(accent, vec3f(1.0), mix(0.22, 0.35, dark_page));
  let outer_color = mix(glow_paper_tint(accent), accent, dark_page);
  let outer_reach = mix(0.66, 1.05, dark_page);

  let outer = soft_mask(uv + heat_offset, em * (outer_reach * intensity));
  let middle = soft_mask(uv, em * (0.45 * intensity));
  let core = soft_mask(uv, em * (0.2 * intensity));

  out.behind = over(out.behind, outer_color, outer * 0.3 * intensity * breath * flame);
  out.behind = over(out.behind, outer_color, middle * mix(0.4, 0.36, dark_page) * intensity * mix(1.0, flame, 0.7));
  out.behind = over(out.behind, core_color, core * 0.5 * intensity * mix(1.0, flame, 0.35));
  return out;
}
`;
