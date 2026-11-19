export const SCENE_WGSL = /* wgsl */ `
struct Plane {
  frame: vec4f,
  rect: vec4f,
  effect: vec4f,
};
@group(0) @binding(0) var<uniform> plane: Plane;
@group(0) @binding(1) var backdrop: texture_2d<f32>;
@group(0) @binding(2) var image: texture_2d<f32>;
@group(0) @binding(3) var image_sampler: sampler;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  var out: Vertex;
  out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}
fn read_backdrop(uv: vec2f) -> vec4f {
  let half_pixel = 0.5 / vec2f(textureDimensions(backdrop));
  return textureSampleLevel(backdrop, image_sampler, clamp(uv, half_pixel, 1.0 - half_pixel), 0.0);
}
fn filtered(uv: vec2f) -> vec4f {
  var sum = vec4f(0.0);
  var weight_sum = 0.0;
  let direction = plane.effect.yz / plane.frame.xy;
  for (var index = -4; index <= 4; index += 1) {
    let distance = f32(index);
    let weight = exp(-distance * distance / 8.0);
    sum += read_backdrop(uv + direction * distance * plane.frame.w / 4.0) * weight;
    weight_sum += weight;
  }
  return sum / weight_sum;
}
@fragment fn fs_main(in: Vertex) -> @location(0) vec4f {
  let mode = plane.frame.z;
  var background = read_backdrop(in.uv);
  if (mode > 1.5 && mode < 2.5) {
    background = textureSampleLevel(image, image_sampler, in.uv, 0.0);
  }
  if (mode > 2.5 && mode < 3.5) { return background; }
  if (mode > 0.5 && mode < 1.5) { return filtered(in.uv); }
  let point = in.uv * plane.frame.xy;
  let local = (point - plane.rect.xy) / plane.rect.zw;
  if (any(local < vec2f(0.0)) || any(local >= vec2f(1.0))) { return background; }
  if (mode > 5.5) {
    let masks = textureSampleLevel(image, image_sampler, local, 0.0).rgb;
    let halo = pow(masks.g, 1.6) * 0.9 + pow(masks.b, 1.4) * 0.45;
    let alpha = clamp(masks.r + halo * (1.0 - masks.r), 0.0, 1.0);
    let color = mix(vec3f(0.16, 0.88, 0.76), vec3f(0.91, 1.0, 0.96), masks.r);
    let foreground = vec4f(color * alpha, alpha) * plane.effect.x;
    return foreground + background * (1.0 - foreground.a);
  }
  let edge = sin(local.x * 3.14159265) * sin(local.y * 3.14159265);
  if (mode > 3.5 && mode < 4.5) {
    let ripple = vec2f(sin(local.y * 18.0), sin(local.x * 12.0)) * edge;
    let refracted = read_backdrop(in.uv + ripple * plane.frame.w * 0.5 / plane.frame.xy);
    return mix(background, refracted, plane.effect.x);
  }
  if (mode > 4.5) {
    let offset = vec2f(plane.frame.w * edge / plane.frame.x, 0.0);
    let red = read_backdrop(in.uv + offset);
    let blue = read_backdrop(in.uv - offset);
    let separated = vec4f(red.r, background.g, blue.b, max(background.a, max(red.a, blue.a)));
    return mix(background, separated, plane.effect.x);
  }
  if (mode > 1.5) { return mix(background, filtered(in.uv), plane.effect.x); }
  let foreground = textureSampleLevel(image, image_sampler, local, 0.0) * plane.effect.x;
  return foreground + background * (1.0 - foreground.a);
}
`;
