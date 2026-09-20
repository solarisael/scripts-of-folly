import { linearToSrgb3 } from "@vgpu/wgsl-std/color";
import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";

struct TerminalWindow {
  resolution: vec2f,
  time: f32,
  intensity: f32,
  motion: f32,
  scheme: f32,
  seed: f32,
  rune_count: f32,
  frame_inset: vec2f,
  halo_radius: f32,
  frame_radius: f32,
}

struct AtlasEntry {
  uv: vec4f,
  bounds: vec4f,
  metrics: vec4f,
}

@group(0) @binding(0) var<uniform> window: TerminalWindow;
@group(0) @binding(1) var<storage, read> entries: array<AtlasEntry>;
@group(0) @binding(2) var glyph_texture: texture_2d<f32>;
@group(0) @binding(3) var glyph_sampler: sampler;

fn rounded_box_distance(point: vec2f, half_size: vec2f, radius: f32) -> f32 {
  let corner = clamp(radius, 0.0, min(half_size.x, half_size.y));
  let offset = abs(point) - half_size + vec2f(corner);
  return length(max(offset, vec2f(0.0)))
    + min(max(offset.x, offset.y), 0.0)
    - corner;
}

fn terminal_runes(pixels: vec2f, size: vec2f) -> f32 {
  let placements = array<vec4f, 12>(
    vec4f(0.12, 0.24, 0.0, 0.03),
    vec4f(0.28, 0.24, 7.0, 0.21),
    vec4f(0.44, 0.24, 15.0, 0.39),
    vec4f(0.60, 0.24, 24.0, 0.57),
    vec4f(0.76, 0.24, 33.0, 0.75),
    vec4f(0.90, 0.24, 41.0, 0.91),
    vec4f(0.12, 0.76, 44.0, 0.14),
    vec4f(0.28, 0.76, 36.0, 0.32),
    vec4f(0.44, 0.76, 27.0, 0.50),
    vec4f(0.60, 0.76, 18.0, 0.68),
    vec4f(0.76, 0.76, 9.0, 0.86),
    vec4f(0.90, 0.76, 3.0, 0.97)
  );
  let rune_count = max(u32(window.rune_count), 1u);
  let scale = clamp(size.x / 720.0, 0.72, 1.0);
  var coverage = 0.0;

  for (var index = 0u; index < 12u; index += 1u) {
    let placement = placements[index];
    let clock = window.time * 0.16 + placement.w;
    let cycle = u32(max(0.0, floor(clock)));
    let glyph_index = (u32(placement.z) + cycle) % rune_count;
    let entry = entries[glyph_index];
    let extent = max(entry.bounds.zw * scale, vec2f(1.0));
    let center = placement.xy * size;
    let local = (pixels - (center - extent * 0.5)) / extent;
    let inside = step(vec2f(0.0), local) * step(local, vec2f(1.0));
    let inside_mask = inside.x * inside.y;
    let atlas_uv = mix(entry.uv.xy, entry.uv.zw, clamp(local, vec2f(0.0), vec2f(1.0)));
    let masks = textureSampleLevel(glyph_texture, glyph_sampler, atlas_uv, 0.0);
    let lifetime = fract(clock);
    let pulse = smoothstep(0.0, 0.16, lifetime)
      * (1.0 - smoothstep(0.72, 1.0, lifetime));
    let glyph = max(masks.r, masks.g * 0.42 + masks.b * 0.18);
    coverage = max(coverage, glyph * inside_mask * pulse);
  }

  return clamp(coverage, 0.0, 1.0);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let pixels = uv * window.resolution;
  let frame_min = window.frame_inset;
  let frame_max = window.resolution - frame_min;
  let frame_size = max(frame_max - frame_min, vec2f(1.0));
  let frame_center = (frame_min + frame_max) * 0.5;
  let frame_half_size = frame_size * 0.5;
  let box_distance = rounded_box_distance(
    pixels - frame_center,
    frame_half_size,
    window.frame_radius
  );
  let inside = 1.0 - smoothstep(-0.5, 0.5, box_distance);
  let inside_edge_distance = max(-box_distance, 0.0);
  let hardlight_half_size = frame_half_size + vec2f(window.halo_radius);
  let hardlight_distance = rounded_box_distance(
    pixels - frame_center,
    hardlight_half_size,
    window.halo_radius
  );
  let hardlight = (1.0 - inside)
    * (1.0 - smoothstep(-0.75, 0.75, hardlight_distance));
  let content_pixels = pixels - frame_min;
  let content_uv = content_pixels / frame_size;
  let canvas_edge_distance = min(
    min(pixels.x, window.resolution.x - pixels.x),
    min(pixels.y, window.resolution.y - pixels.y)
  );
  let minimum_inset = min(window.frame_inset.x, window.frame_inset.y);
  let guard_width = clamp(minimum_inset * 0.5, 12.0, 28.0);
  let canvas_guard = smoothstep(0.0, guard_width, canvas_edge_distance);
  let normalized_position = abs(
    (pixels - frame_center) / max(frame_half_size, vec2f(1.0))
  );
  let vertical_bias = smoothstep(
    0.0,
    0.35,
    normalized_position.y - normalized_position.x
  );
  let halo_distance = max(hardlight_distance, 0.0)
    * mix(1.0, 0.72, vertical_bias);
  let aspect = frame_size.x / max(frame_size.y, 1.0);
  let point = (content_uv - 0.5) * vec2f(aspect, 1.0);
  let drift = window.time * window.motion;
  let fine_noise = fbmSimplex3d(
    vec3f(point * 5.1 + vec2f(0.0, window.seed * 13.0), -drift * 0.035),
    3,
    2.0,
    0.5
  );
  let outer_noise = fbmSimplex3d(
    vec3f(point * 2.0 + vec2f(window.seed * 7.0, 3.1), drift * 0.06),
    4,
    2.0,
    0.5
  );

  let scan_phase = abs(fract(content_pixels.y / 4.0) - 0.5) * 2.0;
  let scan_line = pow(max(0.0, 1.0 - scan_phase), 18.0);

  let grid_cell = vec2f(52.0, 26.0);
  let grid_uv = content_pixels / grid_cell;
  let grid_distance = min(
    abs(fract(grid_uv.x) - 0.5),
    abs(fract(grid_uv.y) - 0.5)
  );
  let ritual_grid = 1.0 - smoothstep(0.018, 0.06, grid_distance);

  let ring_center = vec2f(
    0.18 * sin(window.seed * 19.0),
    0.08 * cos(window.seed * 13.0)
  );
  let ring_point = point - ring_center;
  let ring_radius = 0.18 + sin(drift * 0.55 + window.seed * 9.0) * 0.025;
  let sigil_ring = 1.0 - smoothstep(
    0.009,
    0.025,
    abs(length(ring_point) - ring_radius)
  );

  let sweep_position = fract(drift * 0.055 + window.seed);
  let sweep_delta = abs(content_uv.y - sweep_position);
  let wrapped_sweep_delta = min(sweep_delta, 1.0 - sweep_delta);
  let trace_sweep = 1.0 - smoothstep(0.0, 0.025, wrapped_sweep_delta);
  let terminal_frame = inside
    * (1.0 - smoothstep(0.3, 1.3, inside_edge_distance));

  let dark_surface = vec3f(0.0025, 0.003, 0.0035);
  let light_surface = vec3f(0.62, 0.66, 0.61);
  let gold_signal = vec3f(0.72, 0.55, 0.24);
  let black_signal = vec3f(0.012, 0.014, 0.016);
  let surface = mix(dark_surface, light_surface, window.scheme);
  let signal_color = mix(gold_signal, black_signal, window.scheme);
  let rune_signal = terminal_runes(content_pixels, frame_size);

  let detail = clamp(
    scan_line * 0.07
      + ritual_grid * 0.035
      + rune_signal * 0.24
      + sigil_ring * 0.13
      + trace_sweep * 0.16
      + smoothstep(0.55, 0.9, fine_noise) * 0.035,
    0.0,
    0.34
  ) * inside * window.intensity;
  var inside_color = mix(surface, signal_color, detail);
  inside_color = mix(inside_color, signal_color, terminal_frame * 0.78);

  let liquid_scale = max(
    8.0,
    max(window.frame_inset.x, window.frame_inset.y) * 0.35
  );
  let fog_noise_weight = smoothstep(
    liquid_scale * 0.45,
    liquid_scale * 1.5,
    halo_distance
  );
  let liquid_distance = max(
    0.0,
    halo_distance
      + (outer_noise - 0.5)
        * max(window.frame_inset.x, window.frame_inset.y)
        * 0.3
        * fog_noise_weight
  );
  let fire_motion = mix(0.92, 1.0, smoothstep(0.48, 0.76, fine_noise));
  let near_field = hardlight * fire_motion;
  let opacity_noise = mix(
    1.0,
    clamp(0.22 + outer_noise * 1.15, 0.0, 1.25),
    fog_noise_weight
  );
  let liquid_field = exp(-liquid_distance / liquid_scale)
    * opacity_noise
    * (1.0 - inside);
  let near_alpha = near_field * 0.96;
  let liquid_alpha = liquid_field * mix(0.2, 0.32, window.scheme);
  let outside_alpha = (
    near_alpha + liquid_alpha * (1.0 - near_alpha)
  ) * canvas_guard;
  let fog_color = mix(
    vec3f(0.001, 0.0015, 0.002),
    vec3f(0.78, 0.76, 0.68),
    window.scheme
  );
  let outside_color = fog_color;
  let inside_alpha = inside * 0.98;
  let alpha = inside_alpha + outside_alpha * (1.0 - inside_alpha);
  let inside_display = linearToSrgb3(inside_color);
  let outside_display = linearToSrgb3(outside_color);
  let premultiplied = inside_display * inside_alpha
    + outside_display * outside_alpha * (1.0 - inside_alpha);

  return vec4f(premultiplied, alpha);
}
