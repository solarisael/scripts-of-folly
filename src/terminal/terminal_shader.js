// Generated from terminal.wgsl by bun run build:terminal-shader.
const terminal_source = String.raw`struct _vgsl_310ffc77__TerminalWindow {
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

struct _vgsl_310ffc77__AtlasEntry {
  uv: vec4f,
  bounds: vec4f,
  metrics: vec4f,
}

@group(0) @binding(0) var<uniform> window: _vgsl_310ffc77__TerminalWindow;
@group(0) @binding(1) var<storage, read> entries: array<_vgsl_310ffc77__AtlasEntry>;
@group(0) @binding(2) var glyph_texture: texture_2d<f32>;
@group(0) @binding(3) var glyph_sampler: sampler;

fn _vgsl_310ffc77__rounded_box_distance(point: vec2f, half_size: vec2f, radius: f32) -> f32 {
  let corner = clamp(radius, 0.0, min(half_size.x, half_size.y));
  let offset = abs(point) - half_size + vec2f(corner);
  return length(max(offset, vec2f(0.0)))
    + min(max(offset.x, offset.y), 0.0)
    - corner;
}

fn _vgsl_310ffc77__terminal_runes(pixels: vec2f, size: vec2f) -> f32 {
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
  let box_distance = _vgsl_310ffc77__rounded_box_distance(
    pixels - frame_center,
    frame_half_size,
    window.frame_radius
  );
  let inside = 1.0 - smoothstep(-0.5, 0.5, box_distance);
  let inside_edge_distance = max(-box_distance, 0.0);
  let hardlight_half_size = frame_half_size + vec2f(window.halo_radius);
  let hardlight_distance = _vgsl_310ffc77__rounded_box_distance(
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
  let fine_noise = _vgsl_7d56eac9__fbmSimplex3d(
    vec3f(point * 5.1 + vec2f(0.0, window.seed * 13.0), -drift * 0.035),
    3,
    2.0,
    0.5
  );
  let outer_noise = _vgsl_7d56eac9__fbmSimplex3d(
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
  let rune_signal = _vgsl_310ffc77__terminal_runes(content_pixels, frame_size);

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
  let inside_display = _vgsl_7a81f1a5__linearToSrgb3(inside_color);
  let outside_display = _vgsl_7a81f1a5__linearToSrgb3(outside_color);
  let premultiplied = inside_display * inside_alpha
    + outside_display * outside_alpha * (1.0 - inside_alpha);

  return vec4f(premultiplied, alpha);
}



 

 

 

 

 fn _vgsl_7a81f1a5__linearToSrgb(value: f32) -> f32 {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

 fn _vgsl_7a81f1a5__linearToSrgb3(value: vec3f) -> vec3f {
  return vec3f(_vgsl_7a81f1a5__linearToSrgb(value.r), _vgsl_7a81f1a5__linearToSrgb(value.g), _vgsl_7a81f1a5__linearToSrgb(value.b));
}

 

 

 

 

// Simplex noise on the skewed simplicial lattice (Perlin 2001; Gustavson, "Simplex noise
// demystified"), re-derived on this package's integer pcg hashes -- no code copied, no permutation
// table, no period-289 float hash, and no \`sqrt\`/trig anywhere in the core (see
// ../internal/gradient.wgsl for the determinism contract this module inherits).
//
// Range is a *proof*, not an observation: the kernel sum is bounded by its measured supremum
// (0.0100802047 for 2D, 0.0130071572 for 3D) and the normalizers below sit just under 1/sup, so
// abs(simplex2d(p)) <= 0.98786 and abs(simplex3d(p)) <= 0.98854 for every finite input. Do not
// replace them with the folkloric webgl-noise scale factors, which exceed 1 and force consumers to
// clamp. sigma is ~0.533 (2D) / ~0.388 (3D): ~1.7x Perlin's, with ~2.5x the slope, so
// \`simplex3d(p)\` is a higher-frequency field than \`perlin3d(p)\` -- scale \`p\` by ~0.4-0.5 when
// migrating (see index.docs.md).
        

// Skew/unskew constants, spelled as precomputed decimal literals because \`sqrt\` is banned in the
// core: its accuracy is implementation-defined, which would make the goldens driver-dependent.
      // (sqrt(3) - 1) / 2
      // (3 - sqrt(3)) / 6
 // 2 * simplexG2
const _vgsl_7d56eac9__simplexF3: f32 = 0.3333333333333333;       // 1 / 3
const _vgsl_7d56eac9__simplexG3: f32 = 0.16666666666666666;      // 1 / 6
const _vgsl_7d56eac9__simplexG3Twice: f32 = 0.3333333333333333;  // 2 * simplexG3
const _vgsl_7d56eac9__simplexG3Thrice: f32 = 0.5;                // 3 * simplexG3

// Kernel radius^2 is 0.5, NOT the widespread 0.6 (Gustavson/webgl-noise canonical value):
// 0.6 measurably produces C0 cracks (max |dv| ~4.6e-5 to 9.5e-5 vs ~2.9e-8 to 4.8e-8 at 0.5,
// i.e. ~1000x worse) because its support radius (0.775) exceeds the 4-corner traversal's
// reach. See \`simplexCrackDetector\` in tests/simplex.test.ts -- do not "fix" this back to 0.6.
//
// Why 0.5 is exactly right rather than merely smaller: on the face where the corner ranking flips,
// the corner the traversal drops sits at squared distance >= 0.5 from the sample, with equality at
// the tightest point (2D: d = (simplexG2 - 0.5, 0.5), |d|^2 = 0.5 exactly). At radius^2 = 0.5 that
// dropped corner therefore contributes exactly 0 with a vanishing first and second derivative
// (t^4), so the field stays C2 across every simplex face. At 0.6 the same corner still carries
// t = 0.1, and dropping it is a discontinuity.


fn _vgsl_7d56eac9__simplexKernel3(cell: vec3i, d: vec3f) -> f32 {
  let t = 0.5 - dot(d, d);
  if (t <= 0.0) { return 0.0; }
  let t2 = t * t;
  return t2 * t2 * _vgsl_51c0541e__gradDot3(_vgsl_51c0541e__gradIndex3(cell), d);
}

// 2D simplex: 3 corners of a triangle in the sheared lattice. \`vec2i(base)\` (never
// \`vec2i(position)\`) keeps negative coordinates correct, and there is no float \`mod\` anywhere --
// WGSL's \`%\` truncates toward the dividend, unlike GLSL's \`mod\`, which is how ported noise code
// silently breaks for p < 0.
 

// 3D simplex: 4 corners of a tetrahedron, i.e. half the 8 corners perlin3d needs (4 pcg3d hashes
// against Perlin's 8).
 fn _vgsl_7d56eac9__simplex3d(position: vec3f) -> f32 {
  let skew = (position.x + position.y + position.z) * _vgsl_7d56eac9__simplexF3;
  let base = floor(position + vec3f(skew));
  let cell = vec3i(base);
  let unskew = (base.x + base.y + base.z) * _vgsl_7d56eac9__simplexG3;
  let d0 = position - (base - vec3f(unskew));

  // Traversal order = ranking of d0's components (the classic error-prone step). The six branches
  // are the six orderings of (x, y, z): \`o1\` steps along the largest component and \`o2\` adds the
  // second largest, so the pair encodes *which two* of the four tetrahedron corners are visited in
  // the middle. Do not "simplify" this into arithmetic on comparisons -- every collapsed variant
  // swaps a corner for at least one ordering, which the goldens and the crack detector catch but a
  // statistical test would not.
  var o1 = vec3f(0.0);
  var o2 = vec3f(0.0);
  if (d0.x >= d0.y) {
    if (d0.y >= d0.z)      { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); } // x >= y >= z
    else if (d0.x >= d0.z) { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 0.0, 1.0); } // x >= z > y
    else                   { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(1.0, 0.0, 1.0); } // z > x >= y
  } else {
    if (d0.y < d0.z)       { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(0.0, 1.0, 1.0); } // z > y > x
    else if (d0.x < d0.z)  { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(0.0, 1.0, 1.0); } // y >= z > x
    else                   { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); } // y > x >= z
  }

  let d1 = d0 - o1 + vec3f(_vgsl_7d56eac9__simplexG3);
  let d2 = d0 - o2 + vec3f(_vgsl_7d56eac9__simplexG3Twice);
  let d3 = d0 - vec3f(1.0) + vec3f(_vgsl_7d56eac9__simplexG3Thrice);
  var total = _vgsl_7d56eac9__simplexKernel3(cell, d0);
  total = total + _vgsl_7d56eac9__simplexKernel3(cell + vec3i(o1), d1);
  total = total + _vgsl_7d56eac9__simplexKernel3(cell + vec3i(o2), d2);
  total = total + _vgsl_7d56eac9__simplexKernel3(cell + vec3i(1, 1, 1), d3);
  // raw sup = 0.0130071572, so 76.0 < 1/sup: abs(value) <= 0.98854, never clipped.
  return 76.0 * total;
}

// Amplitude-normalized FBM: dividing by the sum of the amplitudes is what makes the (-1, 1)
// guarantee survive octaves (abs(sum) <= weight by construction, and weight >= 1 so the division is
// always safe). \`octaves\` is clamped to [1, 16] because an unbounded dynamic loop count is a
// GPU-hang risk, and \`gain\` to [0, 1] because a negative gain would break weight = sum of |a| and
// with it the range proof. Both clamps are silent and documented. Free invariant:
// \`fbmSimplex2d(p, 1, lacunarity, gain)\` is exactly \`simplex2d(p)\`.
 

 fn _vgsl_7d56eac9__fbmSimplex3d(position: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let count = clamp(octaves, 1, 16);
  let decay = clamp(gain, 0.0, 1.0);
  var sum = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var sample = position;
  for (var i = 0; i < count; i = i + 1) {
    sum = sum + amplitude * _vgsl_7d56eac9__simplex3d(sample);
    weight = weight + amplitude;
    sample = sample * lacunarity;
    amplitude = amplitude * decay;
  }
  return sum / weight;
}

// Shared, table-free gradient core for the gradient-noise families (perlin/, simplex/).
//
// Private module: it is intentionally absent from this package's \`package.json\` exports, so the
// only way in is a relative import from a sibling noise module
// (\`import { gradDot3 } from "../internal/gradient.wgsl";\`). The declarations still carry \`export\`
// because the resolver keys its import graph off that literal token
// (packages/wgsl/src/runtime/parser.ts) -- \`export\` here means "importable by a relative sibling",
// not "public API".
//
// Determinism contract (locked by tests/noise-gradient.test.ts):
//   * no \`array<...>\` anywhere: permutation/gradient tables cost shader text in every consumer and
//     backends expand or spill them anyway, buying nothing over a few \`select\`s.
//   * no \`sin\`/\`cos\`/\`sqrt\`/\`inverseSqrt\`/\`pow\` anywhere: their accuracy is implementation-defined
//     (WGSL allows several ulp), so an angle-based gradient would drift per driver and make golden
//     tests flaky. Everything below is \`+ - * select\` plus the exactly specified u32 hash ops, so
//     *which* gradient a cell gets is bit-identical on every backend.
//
// References (algorithms, no code copied): Perlin 2002 "Improving Noise" (quintic fade, 12
// cube-edge gradients), Perlin 2001 / Gustavson "Simplex noise demystified".
      

// 1 / sqrt(2), spelled as a literal because \`sqrt\` is banned above.
 

// Gradient selector: pcg2d/pcg3d over the bit pattern of the integer cell (same idiom as
// voronoi2d/voronoi3d), giving a 2^32-cell period instead of the folklore period-289 float hash.
 

// 12 gradients out of 32 bits: bias is 4/2^32 ~= 1e-9.
 fn _vgsl_51c0541e__gradIndex3(cell: vec3i) -> u32 { return _vgsl_0db9cd76__pcg3d(bitcast<vec3u>(cell)).x % 12u; }

// 8 unit gradients. index 0..3 -> (1,0) (-1,0) (0,1) (0,-1);  4..7 -> (+-1,+-1)/sqrt(2).
// Unit length keeps the 2D field's amplitude bound closed-form (raw sup |perlin2d| = 1/sqrt(2)).
 

// Perlin's 12 cube-edge gradients (+-1,+-1,0) (+-1,0,+-1) (0,+-1,+-1), length sqrt(2): the dot
// product costs one add plus two negations, no multiplies.
// index/4 selects the component pair: 0 -> (x,y), 1 -> (x,z), 2 -> (y,z); bits 0/1 are the signs.
 fn _vgsl_51c0541e__gradDot3(index: u32, d: vec3f) -> f32 {
  let pair = index / 4u;
  let a = select(d.x, d.y, pair == 2u);
  let b = select(select(d.y, d.z, pair == 1u), d.z, pair == 2u);
  let sa = select(a, -a, (index & 1u) != 0u);
  let sb = select(b, -b, (index & 2u) != 0u);
  return sa + sb;
}

// Quintic fade 6t^5 - 15t^4 + 10t^3 (Perlin 2002): zero first *and* second derivative at the cell
// boundaries, so lattice seams stay invisible in derivatives (normals) too.
 
 

// Wellons lowbias32: https://github.com/skeeto/hash-prospector
 

 

 fn _vgsl_0db9cd76__pcg3d(value: vec3u) -> vec3u {
  var hashed = value * 1664525u + 1013904223u;
  hashed.x = hashed.x + hashed.y * hashed.z;
  hashed.y = hashed.y + hashed.z * hashed.x;
  hashed.z = hashed.z + hashed.x * hashed.y;
  hashed = hashed ^ (hashed >> vec3u(16u));
  hashed.x = hashed.x + hashed.y * hashed.z;
  hashed.y = hashed.y + hashed.z * hashed.x;
  hashed.z = hashed.z + hashed.x * hashed.y;
  hashed = hashed ^ (hashed >> vec3u(16u));
  return hashed;
}

 

 

 

 
`;

export default terminal_source;
