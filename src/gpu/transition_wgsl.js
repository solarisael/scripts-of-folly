export const TRANSITION_WGSL = String.raw`
fn transition_noise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let weight = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(hash21(cell), hash21(cell + vec2f(1.0, 0.0)), weight.x),
    mix(hash21(cell + vec2f(0.0, 1.0)), hash21(cell + vec2f(1.0)), weight.x),
    weight.y
  );
}

fn transition_blur(uv: vec2f, radius: vec2f) -> vec4f {
  var ink = vec4f(0.0);
  for (var y: i32 = -1; y <= 1; y += 1) {
    for (var x: i32 = -1; x <= 1; x += 1) {
      let pixel = sample_rgba(uv + vec2f(f32(x), f32(y)) * radius);
      ink += vec4f(pixel.rgb * pixel.a, pixel.a);
    }
  }
  return vec4f(ink.rgb / max(ink.a, 0.00001), ink.a / 9.0);
}

fn transition_ink(uv: vec2f) -> vec4f {
  let progress = clamp(transition.y, 0.0, 1.0);
  if (progress <= 0.0) { return sample_rgba(uv); }
  if (progress >= 1.0) { return vec4f(0.0); }

  let size = max(surface.xy, vec2f(1.0));
  let pixel = uv * size;
  let seed = vec2f(transition.z * 17.0, transition.z * 31.0);

  if (transition.x < 1.5) {
    let grain = floor(pixel / 3.0) + seed;
    let noise = hash21(grain);
    let drift = vec2f((hash21(grain + vec2f(7.0, 3.0)) - 0.5) * 28.0,
      -24.0 * (0.3 + noise)) * progress * progress;
    let ink = sample_rgba(uv - drift / size);
    let remaining = 1.0 - smoothstep(noise * 0.65 + 0.1, noise * 0.65 + 0.35, progress);
    return vec4f(ink.rgb, ink.a * remaining);
  }

  let cloud = transition_noise(pixel / 24.0 + seed + vec2f(progress * 1.4, -progress));
  let detail = transition_noise(pixel / 9.0 + seed);
  let density = cloud * 0.7 + detail * 0.3;
  let drift = vec2f(sin(pixel.y / 18.0 + seed.x + progress * 4.0) * 7.0,
    -10.0 - cloud * 8.0) * progress;
  let ink = transition_blur(uv - drift / size, vec2f(progress * 6.0) / size);
  let remaining = 1.0 - smoothstep(density * 0.45 + 0.15, density * 0.45 + 0.55, progress);
  return vec4f(ink.rgb, ink.a * remaining);
}
`;
