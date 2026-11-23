// Generated from terminal.wgsl by bun run build:terminal-shader.
const freeze = (value) => {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

export default /* @__PURE__ */ freeze({
  "version": 2,
  "wgsl": "struct _vgsl_b7f3d5fd__TerminalWindow {\n  resolution: vec2f,\n  time: f32,\n  intensity: f32,\n  motion: f32,\n  scheme: f32,\n  seed: f32,\n  rune_count: f32,\n  frame_inset: vec2f,\n  halo_radius: f32,\n  frame_radius: f32,\n}\n\nstruct _vgsl_b7f3d5fd__AtlasEntry {\n  uv: vec4f,\n  bounds: vec4f,\n  metrics: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> window: _vgsl_b7f3d5fd__TerminalWindow;\n@group(0) @binding(1) var<storage, read> entries: array<_vgsl_b7f3d5fd__AtlasEntry>;\n@group(0) @binding(2) var glyph_texture: texture_2d<f32>;\n@group(0) @binding(3) var glyph_sampler: sampler;\n\nfn _vgsl_b7f3d5fd__rounded_box_distance(point: vec2f, half_size: vec2f, radius: f32) -> f32 {\n  let corner = clamp(radius, 0.0, min(half_size.x, half_size.y));\n  let offset = abs(point) - half_size + vec2f(corner);\n  return length(max(offset, vec2f(0.0)))\n    + min(max(offset.x, offset.y), 0.0)\n    - corner;\n}\n\nfn _vgsl_b7f3d5fd__terminal_runes(pixels: vec2f, size: vec2f) -> f32 {\n  let placements = array<vec4f, 12>(\n    vec4f(0.12, 0.24, 0.0, 0.03),\n    vec4f(0.28, 0.24, 7.0, 0.21),\n    vec4f(0.44, 0.24, 15.0, 0.39),\n    vec4f(0.60, 0.24, 24.0, 0.57),\n    vec4f(0.76, 0.24, 33.0, 0.75),\n    vec4f(0.90, 0.24, 41.0, 0.91),\n    vec4f(0.12, 0.76, 44.0, 0.14),\n    vec4f(0.28, 0.76, 36.0, 0.32),\n    vec4f(0.44, 0.76, 27.0, 0.50),\n    vec4f(0.60, 0.76, 18.0, 0.68),\n    vec4f(0.76, 0.76, 9.0, 0.86),\n    vec4f(0.90, 0.76, 3.0, 0.97)\n  );\n  let rune_count = max(u32(window.rune_count), 1u);\n  let scale = clamp(size.x / 720.0, 0.72, 1.0);\n  var coverage = 0.0;\n\n  for (var index = 0u; index < 12u; index += 1u) {\n    let placement = placements[index];\n    let clock = window.time * 0.16 + placement.w;\n    let cycle = u32(max(0.0, floor(clock)));\n    let glyph_index = (u32(placement.z) + cycle) % rune_count;\n    let entry = entries[glyph_index];\n    let extent = max(entry.bounds.zw * scale, vec2f(1.0));\n    let center = placement.xy * size;\n    let local = (pixels - (center - extent * 0.5)) / extent;\n    let inside = step(vec2f(0.0), local) * step(local, vec2f(1.0));\n    let inside_mask = inside.x * inside.y;\n    let atlas_uv = mix(entry.uv.xy, entry.uv.zw, clamp(local, vec2f(0.0), vec2f(1.0)));\n    let masks = textureSampleLevel(glyph_texture, glyph_sampler, atlas_uv, 0.0);\n    let lifetime = fract(clock);\n    let pulse = smoothstep(0.0, 0.16, lifetime)\n      * (1.0 - smoothstep(0.72, 1.0, lifetime));\n    let glyph = max(masks.r, masks.g * 0.42 + masks.b * 0.18);\n    coverage = max(coverage, glyph * inside_mask * pulse);\n  }\n\n  return clamp(coverage, 0.0, 1.0);\n}\n\n@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {\n  let pixels = uv * window.resolution;\n  let frame_min = window.frame_inset;\n  let frame_max = window.resolution - frame_min;\n  let frame_size = max(frame_max - frame_min, vec2f(1.0));\n  let frame_center = (frame_min + frame_max) * 0.5;\n  let frame_half_size = frame_size * 0.5;\n  let box_distance = _vgsl_b7f3d5fd__rounded_box_distance(\n    pixels - frame_center,\n    frame_half_size,\n    window.frame_radius\n  );\n  let inside = 1.0 - smoothstep(-0.5, 0.5, box_distance);\n  let inside_edge_distance = max(-box_distance, 0.0);\n  let hardlight_half_size = frame_half_size + vec2f(window.halo_radius);\n  let hardlight_distance = _vgsl_b7f3d5fd__rounded_box_distance(\n    pixels - frame_center,\n    hardlight_half_size,\n    window.halo_radius\n  );\n  let hardlight = (1.0 - inside)\n    * (1.0 - smoothstep(-0.75, 0.75, hardlight_distance));\n  let content_pixels = pixels - frame_min;\n  let content_uv = content_pixels / frame_size;\n  let canvas_edge_distance = min(\n    min(pixels.x, window.resolution.x - pixels.x),\n    min(pixels.y, window.resolution.y - pixels.y)\n  );\n  let minimum_inset = min(window.frame_inset.x, window.frame_inset.y);\n  let guard_width = clamp(minimum_inset * 0.5, 12.0, 28.0);\n  let canvas_guard = smoothstep(0.0, guard_width, canvas_edge_distance);\n  let normalized_position = abs(\n    (pixels - frame_center) / max(frame_half_size, vec2f(1.0))\n  );\n  let vertical_bias = smoothstep(\n    0.0,\n    0.35,\n    normalized_position.y - normalized_position.x\n  );\n  let halo_distance = max(hardlight_distance, 0.0)\n    * mix(1.0, 0.72, vertical_bias);\n  let aspect = frame_size.x / max(frame_size.y, 1.0);\n  let point = (content_uv - 0.5) * vec2f(aspect, 1.0);\n  let drift = window.time * window.motion;\n  let fine_noise = _vgsl_24805ff0__fbmSimplex3d(\n    vec3f(point * 5.1 + vec2f(0.0, window.seed * 13.0), -drift * 0.035),\n    3,\n    2.0,\n    0.5\n  );\n  let outer_noise = _vgsl_24805ff0__fbmSimplex3d(\n    vec3f(point * 2.0 + vec2f(window.seed * 7.0, 3.1), drift * 0.06),\n    4,\n    2.0,\n    0.5\n  );\n\n  let scan_phase = abs(fract(content_pixels.y / 4.0) - 0.5) * 2.0;\n  let scan_line = pow(max(0.0, 1.0 - scan_phase), 18.0);\n\n  let grid_cell = vec2f(52.0, 26.0);\n  let grid_uv = content_pixels / grid_cell;\n  let grid_distance = min(\n    abs(fract(grid_uv.x) - 0.5),\n    abs(fract(grid_uv.y) - 0.5)\n  );\n  let ritual_grid = 1.0 - smoothstep(0.018, 0.06, grid_distance);\n\n  let ring_center = vec2f(\n    0.18 * sin(window.seed * 19.0),\n    0.08 * cos(window.seed * 13.0)\n  );\n  let ring_point = point - ring_center;\n  let ring_radius = 0.18 + sin(drift * 0.55 + window.seed * 9.0) * 0.025;\n  let sigil_ring = 1.0 - smoothstep(\n    0.009,\n    0.025,\n    abs(length(ring_point) - ring_radius)\n  );\n\n  let sweep_position = fract(drift * 0.055 + window.seed);\n  let sweep_delta = abs(content_uv.y - sweep_position);\n  let wrapped_sweep_delta = min(sweep_delta, 1.0 - sweep_delta);\n  let trace_sweep = 1.0 - smoothstep(0.0, 0.025, wrapped_sweep_delta);\n  let terminal_frame = inside\n    * (1.0 - smoothstep(0.3, 1.3, inside_edge_distance));\n\n  let dark_surface = vec3f(0.0025, 0.003, 0.0035);\n  let light_surface = vec3f(0.62, 0.66, 0.61);\n  let gold_signal = vec3f(0.72, 0.55, 0.24);\n  let black_signal = vec3f(0.012, 0.014, 0.016);\n  let surface = mix(dark_surface, light_surface, window.scheme);\n  let signal_color = mix(gold_signal, black_signal, window.scheme);\n  let rune_signal = _vgsl_b7f3d5fd__terminal_runes(content_pixels, frame_size);\n\n  let detail = clamp(\n    scan_line * 0.07\n      + ritual_grid * 0.035\n      + rune_signal * 0.24\n      + sigil_ring * 0.13\n      + trace_sweep * 0.16\n      + smoothstep(0.55, 0.9, fine_noise) * 0.035,\n    0.0,\n    0.34\n  ) * inside * window.intensity;\n  var inside_color = mix(surface, signal_color, detail);\n  inside_color = mix(inside_color, signal_color, terminal_frame * 0.78);\n\n  let liquid_scale = max(\n    8.0,\n    max(window.frame_inset.x, window.frame_inset.y) * 0.35\n  );\n  let fog_noise_weight = smoothstep(\n    liquid_scale * 0.45,\n    liquid_scale * 1.5,\n    halo_distance\n  );\n  let liquid_distance = max(\n    0.0,\n    halo_distance\n      + (outer_noise - 0.5)\n        * max(window.frame_inset.x, window.frame_inset.y)\n        * 0.3\n        * fog_noise_weight\n  );\n  let fire_motion = mix(0.92, 1.0, smoothstep(0.48, 0.76, fine_noise));\n  let near_field = hardlight * fire_motion;\n  let opacity_noise = mix(\n    1.0,\n    clamp(0.22 + outer_noise * 1.15, 0.0, 1.25),\n    fog_noise_weight\n  );\n  let liquid_field = exp(-liquid_distance / liquid_scale)\n    * opacity_noise\n    * (1.0 - inside);\n  let near_alpha = near_field * 0.96;\n  let liquid_alpha = liquid_field * mix(0.2, 0.32, window.scheme);\n  let outside_alpha = (\n    near_alpha + liquid_alpha * (1.0 - near_alpha)\n  ) * canvas_guard;\n  let fog_color = mix(\n    vec3f(0.001, 0.0015, 0.002),\n    vec3f(0.78, 0.76, 0.68),\n    window.scheme\n  );\n  let outside_color = fog_color;\n  let inside_alpha = inside * 0.98;\n  let alpha = inside_alpha + outside_alpha * (1.0 - inside_alpha);\n  let inside_display = _vgsl_70356459__linearToSrgb3(inside_color);\n  let outside_display = _vgsl_70356459__linearToSrgb3(outside_color);\n  let premultiplied = inside_display * inside_alpha\n    + outside_display * outside_alpha * (1.0 - inside_alpha);\n\n  return vec4f(premultiplied, alpha);\n}\n\n\n\n \n\n \n\n \n\n \n\n fn _vgsl_70356459__linearToSrgb(value: f32) -> f32 {\n  if (value <= 0.0031308) {\n    return value * 12.92;\n  }\n  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;\n}\n\n fn _vgsl_70356459__linearToSrgb3(value: vec3f) -> vec3f {\n  return vec3f(_vgsl_70356459__linearToSrgb(value.r), _vgsl_70356459__linearToSrgb(value.g), _vgsl_70356459__linearToSrgb(value.b));\n}\n\n \n\n \n\n \n\n \n\n// Simplex noise on the skewed simplicial lattice (Perlin 2001; Gustavson, \"Simplex noise\n// demystified\"), re-derived on this package's integer pcg hashes -- no code copied, no permutation\n// table, no period-289 float hash, and no `sqrt`/trig anywhere in the core (see\n// ../internal/gradient.wgsl for the determinism contract this module inherits).\n//\n// Range is a *proof*, not an observation: the kernel sum is bounded by its measured supremum\n// (0.0100802047 for 2D, 0.0130071572 for 3D) and the normalizers below sit just under 1/sup, so\n// abs(simplex2d(p)) <= 0.98786 and abs(simplex3d(p)) <= 0.98854 for every finite input. Do not\n// replace them with the folkloric webgl-noise scale factors, which exceed 1 and force consumers to\n// clamp. sigma is ~0.533 (2D) / ~0.388 (3D): ~1.7x Perlin's, with ~2.5x the slope, so\n// `simplex3d(p)` is a higher-frequency field than `perlin3d(p)` -- scale `p` by ~0.4-0.5 when\n// migrating (see index.docs.md).\n        \n\n// Skew/unskew constants, spelled as precomputed decimal literals because `sqrt` is banned in the\n// core: its accuracy is implementation-defined, which would make the goldens driver-dependent.\n      // (sqrt(3) - 1) / 2\n      // (3 - sqrt(3)) / 6\n // 2 * simplexG2\nconst _vgsl_24805ff0__simplexF3: f32 = 0.3333333333333333;       // 1 / 3\nconst _vgsl_24805ff0__simplexG3: f32 = 0.16666666666666666;      // 1 / 6\nconst _vgsl_24805ff0__simplexG3Twice: f32 = 0.3333333333333333;  // 2 * simplexG3\nconst _vgsl_24805ff0__simplexG3Thrice: f32 = 0.5;                // 3 * simplexG3\n\n// Kernel radius^2 is 0.5, NOT the widespread 0.6 (Gustavson/webgl-noise canonical value):\n// 0.6 measurably produces C0 cracks (max |dv| ~4.6e-5 to 9.5e-5 vs ~2.9e-8 to 4.8e-8 at 0.5,\n// i.e. ~1000x worse) because its support radius (0.775) exceeds the 4-corner traversal's\n// reach. See `simplexCrackDetector` in tests/simplex.test.ts -- do not \"fix\" this back to 0.6.\n//\n// Why 0.5 is exactly right rather than merely smaller: on the face where the corner ranking flips,\n// the corner the traversal drops sits at squared distance >= 0.5 from the sample, with equality at\n// the tightest point (2D: d = (simplexG2 - 0.5, 0.5), |d|^2 = 0.5 exactly). At radius^2 = 0.5 that\n// dropped corner therefore contributes exactly 0 with a vanishing first and second derivative\n// (t^4), so the field stays C2 across every simplex face. At 0.6 the same corner still carries\n// t = 0.1, and dropping it is a discontinuity.\n\n\nfn _vgsl_24805ff0__simplexKernel3(cell: vec3i, d: vec3f) -> f32 {\n  let t = 0.5 - dot(d, d);\n  if (t <= 0.0) { return 0.0; }\n  let t2 = t * t;\n  return t2 * t2 * _vgsl_d12334fa__gradDot3(_vgsl_d12334fa__gradIndex3(cell), d);\n}\n\n// 2D simplex: 3 corners of a triangle in the sheared lattice. `vec2i(base)` (never\n// `vec2i(position)`) keeps negative coordinates correct, and there is no float `mod` anywhere --\n// WGSL's `%` truncates toward the dividend, unlike GLSL's `mod`, which is how ported noise code\n// silently breaks for p < 0.\n \n\n// 3D simplex: 4 corners of a tetrahedron, i.e. half the 8 corners perlin3d needs (4 pcg3d hashes\n// against Perlin's 8).\n fn _vgsl_24805ff0__simplex3d(position: vec3f) -> f32 {\n  let skew = (position.x + position.y + position.z) * _vgsl_24805ff0__simplexF3;\n  let base = floor(position + vec3f(skew));\n  let cell = vec3i(base);\n  let unskew = (base.x + base.y + base.z) * _vgsl_24805ff0__simplexG3;\n  let d0 = position - (base - vec3f(unskew));\n\n  // Traversal order = ranking of d0's components (the classic error-prone step). The six branches\n  // are the six orderings of (x, y, z): `o1` steps along the largest component and `o2` adds the\n  // second largest, so the pair encodes *which two* of the four tetrahedron corners are visited in\n  // the middle. Do not \"simplify\" this into arithmetic on comparisons -- every collapsed variant\n  // swaps a corner for at least one ordering, which the goldens and the crack detector catch but a\n  // statistical test would not.\n  var o1 = vec3f(0.0);\n  var o2 = vec3f(0.0);\n  if (d0.x >= d0.y) {\n    if (d0.y >= d0.z)      { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); } // x >= y >= z\n    else if (d0.x >= d0.z) { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 0.0, 1.0); } // x >= z > y\n    else                   { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(1.0, 0.0, 1.0); } // z > x >= y\n  } else {\n    if (d0.y < d0.z)       { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(0.0, 1.0, 1.0); } // z > y > x\n    else if (d0.x < d0.z)  { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(0.0, 1.0, 1.0); } // y >= z > x\n    else                   { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); } // y > x >= z\n  }\n\n  let d1 = d0 - o1 + vec3f(_vgsl_24805ff0__simplexG3);\n  let d2 = d0 - o2 + vec3f(_vgsl_24805ff0__simplexG3Twice);\n  let d3 = d0 - vec3f(1.0) + vec3f(_vgsl_24805ff0__simplexG3Thrice);\n  var total = _vgsl_24805ff0__simplexKernel3(cell, d0);\n  total = total + _vgsl_24805ff0__simplexKernel3(cell + vec3i(o1), d1);\n  total = total + _vgsl_24805ff0__simplexKernel3(cell + vec3i(o2), d2);\n  total = total + _vgsl_24805ff0__simplexKernel3(cell + vec3i(1, 1, 1), d3);\n  // raw sup = 0.0130071572, so 76.0 < 1/sup: abs(value) <= 0.98854, never clipped.\n  return 76.0 * total;\n}\n\n// Amplitude-normalized FBM: dividing by the sum of the amplitudes is what makes the (-1, 1)\n// guarantee survive octaves (abs(sum) <= weight by construction, and weight >= 1 so the division is\n// always safe). `octaves` is clamped to [1, 16] because an unbounded dynamic loop count is a\n// GPU-hang risk, and `gain` to [0, 1] because a negative gain would break weight = sum of |a| and\n// with it the range proof. Both clamps are silent and documented. Free invariant:\n// `fbmSimplex2d(p, 1, lacunarity, gain)` is exactly `simplex2d(p)`.\n \n\n fn _vgsl_24805ff0__fbmSimplex3d(position: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {\n  let count = clamp(octaves, 1, 16);\n  let decay = clamp(gain, 0.0, 1.0);\n  var sum = 0.0;\n  var amplitude = 1.0;\n  var weight = 0.0;\n  var sample = position;\n  for (var i = 0; i < count; i = i + 1) {\n    sum = sum + amplitude * _vgsl_24805ff0__simplex3d(sample);\n    weight = weight + amplitude;\n    sample = sample * lacunarity;\n    amplitude = amplitude * decay;\n  }\n  return sum / weight;\n}\n\n// Shared, table-free gradient core for the gradient-noise families (perlin/, simplex/).\n//\n// Private module: it is intentionally absent from this package's `package.json` exports, so the\n// only way in is a relative import from a sibling noise module\n// (`import { gradDot3 } from \"../internal/gradient.wgsl\";`). The declarations still carry `export`\n// because the resolver keys its import graph off that literal token\n// (packages/wgsl/src/runtime/parser.ts) -- `export` here means \"importable by a relative sibling\",\n// not \"public API\".\n//\n// Determinism contract (locked by tests/noise-gradient.test.ts):\n//   * no `array<...>` anywhere: permutation/gradient tables cost shader text in every consumer and\n//     backends expand or spill them anyway, buying nothing over a few `select`s.\n//   * no `sin`/`cos`/`sqrt`/`inverseSqrt`/`pow` anywhere: their accuracy is implementation-defined\n//     (WGSL allows several ulp), so an angle-based gradient would drift per driver and make golden\n//     tests flaky. Everything below is `+ - * select` plus the exactly specified u32 hash ops, so\n//     *which* gradient a cell gets is bit-identical on every backend.\n//\n// References (algorithms, no code copied): Perlin 2002 \"Improving Noise\" (quintic fade, 12\n// cube-edge gradients), Perlin 2001 / Gustavson \"Simplex noise demystified\".\n      \n\n// 1 / sqrt(2), spelled as a literal because `sqrt` is banned above.\n \n\n// Gradient selector: pcg2d/pcg3d over the bit pattern of the integer cell (same idiom as\n// voronoi2d/voronoi3d), giving a 2^32-cell period instead of the folklore period-289 float hash.\n \n\n// 12 gradients out of 32 bits: bias is 4/2^32 ~= 1e-9.\n fn _vgsl_d12334fa__gradIndex3(cell: vec3i) -> u32 { return _vgsl_e88c80be__pcg3d(bitcast<vec3u>(cell)).x % 12u; }\n\n// 8 unit gradients. index 0..3 -> (1,0) (-1,0) (0,1) (0,-1);  4..7 -> (+-1,+-1)/sqrt(2).\n// Unit length keeps the 2D field's amplitude bound closed-form (raw sup |perlin2d| = 1/sqrt(2)).\n \n\n// Perlin's 12 cube-edge gradients (+-1,+-1,0) (+-1,0,+-1) (0,+-1,+-1), length sqrt(2): the dot\n// product costs one add plus two negations, no multiplies.\n// index/4 selects the component pair: 0 -> (x,y), 1 -> (x,z), 2 -> (y,z); bits 0/1 are the signs.\n fn _vgsl_d12334fa__gradDot3(index: u32, d: vec3f) -> f32 {\n  let pair = index / 4u;\n  let a = select(d.x, d.y, pair == 2u);\n  let b = select(select(d.y, d.z, pair == 1u), d.z, pair == 2u);\n  let sa = select(a, -a, (index & 1u) != 0u);\n  let sb = select(b, -b, (index & 2u) != 0u);\n  return sa + sb;\n}\n\n// Quintic fade 6t^5 - 15t^4 + 10t^3 (Perlin 2002): zero first *and* second derivative at the cell\n// boundaries, so lattice seams stay invisible in derivatives (normals) too.\n \n \n\n// Wellons lowbias32: https://github.com/skeeto/hash-prospector\n \n\n \n\n fn _vgsl_e88c80be__pcg3d(value: vec3u) -> vec3u {\n  var hashed = value * 1664525u + 1013904223u;\n  hashed.x = hashed.x + hashed.y * hashed.z;\n  hashed.y = hashed.y + hashed.z * hashed.x;\n  hashed.z = hashed.z + hashed.x * hashed.y;\n  hashed = hashed ^ (hashed >> vec3u(16u));\n  hashed.x = hashed.x + hashed.y * hashed.z;\n  hashed.y = hashed.y + hashed.z * hashed.x;\n  hashed.z = hashed.z + hashed.x * hashed.y;\n  hashed = hashed ^ (hashed >> vec3u(16u));\n  return hashed;\n}\n\n \n\n \n\n \n\n \n",
  "reflection": {
    "bindings": [
      {
        "group": 0,
        "binding": 0,
        "name": "window",
        "mangledName": "window",
        "type": {
          "kind": "identifier",
          "name": "_vgsl_b7f3d5fd__TerminalWindow",
          "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__TerminalWindow"
        },
        "kind": "buffer",
        "addressSpace": "uniform",
        "struct": {
          "name": "_vgsl_b7f3d5fd__TerminalWindow",
          "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__TerminalWindow",
          "members": [
            {
              "name": "resolution",
              "type": {
                "kind": "vector",
                "width": 2,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              }
            },
            {
              "name": "time",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "intensity",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "motion",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "scheme",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "seed",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "rune_count",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "frame_inset",
              "type": {
                "kind": "vector",
                "width": 2,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              }
            },
            {
              "name": "halo_radius",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            {
              "name": "frame_radius",
              "type": {
                "kind": "scalar",
                "name": "f32"
              }
            }
          ]
        },
        "layout": {
          "name": "window",
          "mangledName": "window",
          "layoutMode": "wgsl-host-shareable-v1",
          "type": {
            "kind": "identifier",
            "name": "_vgsl_b7f3d5fd__TerminalWindow",
            "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__TerminalWindow"
          },
          "align": 8,
          "size": 48,
          "members": [
            {
              "name": "resolution",
              "offset": 0,
              "align": 8,
              "size": 8,
              "type": {
                "kind": "vector",
                "width": 2,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "layout": {
                "name": "resolution",
                "mangledName": "resolution",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "vector",
                  "width": 2,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "align": 8,
                "size": 8
              }
            },
            {
              "name": "time",
              "offset": 8,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "time",
                "mangledName": "time",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "intensity",
              "offset": 12,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "intensity",
                "mangledName": "intensity",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "motion",
              "offset": 16,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "motion",
                "mangledName": "motion",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "scheme",
              "offset": 20,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "scheme",
                "mangledName": "scheme",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "seed",
              "offset": 24,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "seed",
                "mangledName": "seed",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "rune_count",
              "offset": 28,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "rune_count",
                "mangledName": "rune_count",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "frame_inset",
              "offset": 32,
              "align": 8,
              "size": 8,
              "type": {
                "kind": "vector",
                "width": 2,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "layout": {
                "name": "frame_inset",
                "mangledName": "frame_inset",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "vector",
                  "width": 2,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "align": 8,
                "size": 8
              }
            },
            {
              "name": "halo_radius",
              "offset": 40,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "halo_radius",
                "mangledName": "halo_radius",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            },
            {
              "name": "frame_radius",
              "offset": 44,
              "align": 4,
              "size": 4,
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "layout": {
                "name": "frame_radius",
                "mangledName": "frame_radius",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "scalar",
                  "name": "f32"
                },
                "align": 4,
                "size": 4
              }
            }
          ]
        },
        "bindingLayout": {
          "kind": "buffer",
          "buffer": {
            "type": "uniform",
            "hasDynamicOffset": false,
            "minBindingSize": 48
          }
        }
      },
      {
        "group": 0,
        "binding": 1,
        "name": "entries",
        "mangledName": "entries",
        "type": {
          "kind": "array",
          "element": {
            "kind": "identifier",
            "name": "_vgsl_b7f3d5fd__AtlasEntry",
            "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__AtlasEntry"
          }
        },
        "kind": "buffer",
        "addressSpace": "storage",
        "access": "read",
        "layout": {
          "name": "entries",
          "mangledName": "entries",
          "layoutMode": "wgsl-host-shareable-v1",
          "type": {
            "kind": "array",
            "element": {
              "kind": "identifier",
              "name": "_vgsl_b7f3d5fd__AtlasEntry",
              "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__AtlasEntry"
            }
          },
          "align": 16,
          "stride": 48,
          "element": {
            "name": "entries[]",
            "mangledName": "entries[]",
            "layoutMode": "wgsl-host-shareable-v1",
            "type": {
              "kind": "identifier",
              "name": "_vgsl_b7f3d5fd__AtlasEntry",
              "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__AtlasEntry"
            },
            "align": 16,
            "size": 48,
            "members": [
              {
                "name": "uv",
                "offset": 0,
                "align": 16,
                "size": 16,
                "type": {
                  "kind": "vector",
                  "width": 4,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "layout": {
                  "name": "uv",
                  "mangledName": "uv",
                  "layoutMode": "wgsl-host-shareable-v1",
                  "type": {
                    "kind": "vector",
                    "width": 4,
                    "element": {
                      "kind": "scalar",
                      "name": "f32"
                    }
                  },
                  "align": 16,
                  "size": 16
                }
              },
              {
                "name": "bounds",
                "offset": 16,
                "align": 16,
                "size": 16,
                "type": {
                  "kind": "vector",
                  "width": 4,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "layout": {
                  "name": "bounds",
                  "mangledName": "bounds",
                  "layoutMode": "wgsl-host-shareable-v1",
                  "type": {
                    "kind": "vector",
                    "width": 4,
                    "element": {
                      "kind": "scalar",
                      "name": "f32"
                    }
                  },
                  "align": 16,
                  "size": 16
                }
              },
              {
                "name": "metrics",
                "offset": 32,
                "align": 16,
                "size": 16,
                "type": {
                  "kind": "vector",
                  "width": 4,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "layout": {
                  "name": "metrics",
                  "mangledName": "metrics",
                  "layoutMode": "wgsl-host-shareable-v1",
                  "type": {
                    "kind": "vector",
                    "width": 4,
                    "element": {
                      "kind": "scalar",
                      "name": "f32"
                    }
                  },
                  "align": 16,
                  "size": 16
                }
              }
            ]
          },
          "runtimeSized": true
        },
        "bindingLayout": {
          "kind": "buffer",
          "buffer": {
            "type": "read-only-storage",
            "hasDynamicOffset": false
          }
        }
      },
      {
        "group": 0,
        "binding": 2,
        "name": "glyph_texture",
        "mangledName": "glyph_texture",
        "type": {
          "kind": "texture",
          "textureKind": "texture_2d",
          "dimension": "2d",
          "sampleType": {
            "kind": "scalar",
            "name": "f32"
          }
        },
        "kind": "texture",
        "bindingLayout": {
          "kind": "texture",
          "texture": {
            "sampleType": "unfilterable-float",
            "viewDimension": "2d",
            "multisampled": false
          }
        }
      },
      {
        "group": 0,
        "binding": 3,
        "name": "glyph_sampler",
        "mangledName": "glyph_sampler",
        "type": {
          "kind": "sampler",
          "comparison": false
        },
        "kind": "sampler",
        "bindingLayout": {
          "kind": "sampler",
          "sampler": {
            "type": "filtering"
          }
        }
      }
    ],
    "entryPoints": [
      {
        "name": "fs_main",
        "mangledName": "fs_main",
        "stage": "fragment",
        "bindings": [
          {
            "group": 0,
            "binding": 0
          },
          {
            "group": 0,
            "binding": 1
          },
          {
            "group": 0,
            "binding": 2
          },
          {
            "group": 0,
            "binding": 3
          }
        ],
        "samplingPairs": [
          {
            "texture": {
              "group": 0,
              "binding": 2
            },
            "sampler": {
              "group": 0,
              "binding": 3
            },
            "mode": "filtering"
          }
        ]
      }
    ],
    "overrides": [],
    "featuresRequired": [],
    "aliases": [],
    "structs": [
      {
        "name": "_vgsl_b7f3d5fd__TerminalWindow",
        "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__TerminalWindow",
        "members": [
          {
            "name": "resolution",
            "type": {
              "kind": "vector",
              "width": 2,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            }
          },
          {
            "name": "time",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "intensity",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "motion",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "scheme",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "seed",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "rune_count",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "frame_inset",
            "type": {
              "kind": "vector",
              "width": 2,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            }
          },
          {
            "name": "halo_radius",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          },
          {
            "name": "frame_radius",
            "type": {
              "kind": "scalar",
              "name": "f32"
            }
          }
        ]
      },
      {
        "name": "_vgsl_b7f3d5fd__AtlasEntry",
        "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__AtlasEntry",
        "members": [
          {
            "name": "uv",
            "type": {
              "kind": "vector",
              "width": 4,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            }
          },
          {
            "name": "bounds",
            "type": {
              "kind": "vector",
              "width": 4,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            }
          },
          {
            "name": "metrics",
            "type": {
              "kind": "vector",
              "width": 4,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            }
          }
        ]
      }
    ],
    "hostShareableLayouts": [
      {
        "name": "window",
        "mangledName": "window",
        "layoutMode": "wgsl-host-shareable-v1",
        "type": {
          "kind": "identifier",
          "name": "_vgsl_b7f3d5fd__TerminalWindow",
          "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__TerminalWindow"
        },
        "align": 8,
        "size": 48,
        "members": [
          {
            "name": "resolution",
            "offset": 0,
            "align": 8,
            "size": 8,
            "type": {
              "kind": "vector",
              "width": 2,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            "layout": {
              "name": "resolution",
              "mangledName": "resolution",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "vector",
                "width": 2,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "align": 8,
              "size": 8
            }
          },
          {
            "name": "time",
            "offset": 8,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "time",
              "mangledName": "time",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "intensity",
            "offset": 12,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "intensity",
              "mangledName": "intensity",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "motion",
            "offset": 16,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "motion",
              "mangledName": "motion",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "scheme",
            "offset": 20,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "scheme",
              "mangledName": "scheme",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "seed",
            "offset": 24,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "seed",
              "mangledName": "seed",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "rune_count",
            "offset": 28,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "rune_count",
              "mangledName": "rune_count",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "frame_inset",
            "offset": 32,
            "align": 8,
            "size": 8,
            "type": {
              "kind": "vector",
              "width": 2,
              "element": {
                "kind": "scalar",
                "name": "f32"
              }
            },
            "layout": {
              "name": "frame_inset",
              "mangledName": "frame_inset",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "vector",
                "width": 2,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "align": 8,
              "size": 8
            }
          },
          {
            "name": "halo_radius",
            "offset": 40,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "halo_radius",
              "mangledName": "halo_radius",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          },
          {
            "name": "frame_radius",
            "offset": 44,
            "align": 4,
            "size": 4,
            "type": {
              "kind": "scalar",
              "name": "f32"
            },
            "layout": {
              "name": "frame_radius",
              "mangledName": "frame_radius",
              "layoutMode": "wgsl-host-shareable-v1",
              "type": {
                "kind": "scalar",
                "name": "f32"
              },
              "align": 4,
              "size": 4
            }
          }
        ]
      },
      {
        "name": "entries",
        "mangledName": "entries",
        "layoutMode": "wgsl-host-shareable-v1",
        "type": {
          "kind": "array",
          "element": {
            "kind": "identifier",
            "name": "_vgsl_b7f3d5fd__AtlasEntry",
            "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__AtlasEntry"
          }
        },
        "align": 16,
        "stride": 48,
        "element": {
          "name": "entries[]",
          "mangledName": "entries[]",
          "layoutMode": "wgsl-host-shareable-v1",
          "type": {
            "kind": "identifier",
            "name": "_vgsl_b7f3d5fd__AtlasEntry",
            "mangledName": "_vgsl_b588855a___vgsl_b7f3d5fd__AtlasEntry"
          },
          "align": 16,
          "size": 48,
          "members": [
            {
              "name": "uv",
              "offset": 0,
              "align": 16,
              "size": 16,
              "type": {
                "kind": "vector",
                "width": 4,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "layout": {
                "name": "uv",
                "mangledName": "uv",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "vector",
                  "width": 4,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "align": 16,
                "size": 16
              }
            },
            {
              "name": "bounds",
              "offset": 16,
              "align": 16,
              "size": 16,
              "type": {
                "kind": "vector",
                "width": 4,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "layout": {
                "name": "bounds",
                "mangledName": "bounds",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "vector",
                  "width": 4,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "align": 16,
                "size": 16
              }
            },
            {
              "name": "metrics",
              "offset": 32,
              "align": 16,
              "size": 16,
              "type": {
                "kind": "vector",
                "width": 4,
                "element": {
                  "kind": "scalar",
                  "name": "f32"
                }
              },
              "layout": {
                "name": "metrics",
                "mangledName": "metrics",
                "layoutMode": "wgsl-host-shareable-v1",
                "type": {
                  "kind": "vector",
                  "width": 4,
                  "element": {
                    "kind": "scalar",
                    "name": "f32"
                  }
                },
                "align": 16,
                "size": 16
              }
            }
          ]
        },
        "runtimeSized": true
      }
    ]
  },
  "sourceChecksum": "fnv1a64-utf16le-v1:2ac61d6847423df0",
  "producer": "@vgpu/wgsl/prepare-v2"
});
