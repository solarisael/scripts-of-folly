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

// Crumble: the ink breaks into squares where it stands. Each crumb moves away
// and fades. With a travel vector, a front goes over the text from the side
// nearest the destination, and the crumbs flow along the vector. Without one,
// each crumb drifts in its own direction.
//
// The crumbs are in flocks. The crumbs of one flock share one path and one
// delay, so a fragment finds the crumb over it with one solve for each flock.
const CRUMB_SIZE: f32 = 2.0;
const CRUMB_FLOCKS: i32 = 12;
// Shares of the progress: the front crosses the text, and one crumb flies.
const CRUMB_FRONT: f32 = 0.25;
const CRUMB_FLIGHT: f32 = 0.45;

fn crumb_flock(cell: vec2f, seed: vec2f) -> i32 {
  return i32(floor(hash21(cell + seed) * f32(CRUMB_FLOCKS)));
}

fn crumble_ink(quad_uv: vec2f, progress: f32) -> vec4f {
  let size = max(surface.xy, vec2f(1.0));
  // vs_main grows the quad by the travel. This is the CSS pixel of the capture.
  let pixel = quad_uv * (size + abs(travel.xy)) - max(-travel.xy, vec2f(0.0));
  let seed = vec2f(transition.z * 17.0, transition.z * 31.0);

  let reach = length(travel.xy);
  let directed = reach > 0.5;
  let heading = select(vec2f(0.0, -1.0), travel.xy / max(reach, 0.5), directed);

  // A crumb at point p breaks loose at
  // front_rate * (front_start - dot(p, heading)) + the delay of its flock.
  let far_corner = heading * size;
  let front_start = max(far_corner.x, 0.0) + max(far_corner.y, 0.0);
  let front_end = min(far_corner.x, 0.0) + min(far_corner.y, 0.0);
  let front_share = select(0.0, CRUMB_FRONT, directed);
  let front_rate = front_share / max(front_start - front_end, 1.0);
  let delay_step = (1.0 - CRUMB_FLIGHT - front_share) / f32(CRUMB_FLOCKS);

  var ink = vec4f(0.0);

  let home_cell = floor(pixel / CRUMB_SIZE);
  let home_center = (home_cell + vec2f(0.5)) * CRUMB_SIZE;
  let home_release = front_rate * (front_start - dot(home_center, heading))
    + delay_step * f32(crumb_flock(home_cell, seed));
  if (progress <= home_release) {
    ink = sample_rgba(pixel / size);
  }

  for (var flock: i32 = 0; flock < CRUMB_FLOCKS; flock += 1) {
    let turn = fract((f32(flock) + transition.z) * 0.6180340);
    let haste = fract((f32(flock) + transition.z) * 0.7548777);
    let flight = CRUMB_FLIGHT * (0.7 + 0.3 * haste);
    let delay = delay_step * f32(flock);

    // A directed flock ends at most 24 px to the side of the travel, which
    // the padding of the capture covers. A free flock drifts 16 to 30 px.
    var angle = turn * 6.2831853;
    var path = vec2f(cos(angle), sin(angle)) * (16.0 + 14.0 * haste);
    if (directed) {
      angle = (turn - 0.5) * 2.0 * min(0.3, 24.0 / reach);
      path = vec2f(
        travel.x * cos(angle) - travel.y * sin(angle),
        travel.x * sin(angle) + travel.y * cos(angle)
      );
    }
    let velocity = path / flight;

    // Solve start + velocity * (progress - release(start)) = pixel for start.
    let unreleased = pixel - velocity * (progress - front_rate * front_start - delay);
    let along = dot(unreleased, heading) / (1.0 + front_rate * dot(velocity, heading));
    let start = unreleased - velocity * front_rate * along;

    let cell = floor(start / CRUMB_SIZE);
    if (crumb_flock(cell, seed) != flock) { continue; }

    let center = (cell + vec2f(0.5)) * CRUMB_SIZE;
    let release = front_rate * (front_start - dot(center, heading)) + delay;
    let age = (progress - release) / flight;
    if (age <= 0.0 || age >= 1.0) { continue; }

    let offset = pixel - (center + path * age);
    if (max(abs(offset.x), abs(offset.y)) > CRUMB_SIZE * 0.5) { continue; }

    let crumb = sample_rgba((center + offset) / size);
    let cover = crumb.a * (1.0 - smoothstep(0.65, 1.0, age));
    let total = cover + ink.a * (1.0 - cover);
    ink = vec4f(
      (crumb.rgb * cover + ink.rgb * ink.a * (1.0 - cover)) / max(total, 0.00001),
      total
    );
  }

  return ink;
}

fn transition_ink(uv: vec2f) -> vec4f {
  let progress = clamp(transition.y, 0.0, 1.0);
  if (transition.x > 2.5) { return crumble_ink(uv, progress); }

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
