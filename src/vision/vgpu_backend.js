const BANNER_SHADER = /* wgsl */ `
struct Params {
  canvas_size: vec2f,
  image_size: vec2f,
  time: f32,
  variant: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var image_texture: texture_2d<f32>;
@group(0) @binding(2) var image_sampler: sampler;
fn hash31(point: vec3f) -> f32 {
  let value = sin(dot(point, vec3f(127.1, 311.7, 74.7))) * 43758.5453;
  return fract(value);
}

fn noise3(point: vec3f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let smooth_local = local * local * (3.0 - 2.0 * local);
  let c000 = hash31(cell);
  let c100 = hash31(cell + vec3f(1.0, 0.0, 0.0));
  let c010 = hash31(cell + vec3f(0.0, 1.0, 0.0));
  let c110 = hash31(cell + vec3f(1.0, 1.0, 0.0));
  let c001 = hash31(cell + vec3f(0.0, 0.0, 1.0));
  let c101 = hash31(cell + vec3f(1.0, 0.0, 1.0));
  let c011 = hash31(cell + vec3f(0.0, 1.0, 1.0));
  let c111 = hash31(cell + vec3f(1.0, 1.0, 1.0));
  let x00 = mix(c000, c100, smooth_local.x);
  let x10 = mix(c010, c110, smooth_local.x);
  let x01 = mix(c001, c101, smooth_local.x);
  let x11 = mix(c011, c111, smooth_local.x);
  return mix(mix(x00, x10, smooth_local.y), mix(x01, x11, smooth_local.y), smooth_local.z);
}

fn fractal_noise3(point: vec3f) -> f32 {
  var total = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  for (var octave = 0; octave < 3; octave += 1) {
    total += noise3(point * frequency) * amplitude;
    frequency *= 2.01;
    amplitude *= 0.6;
  }
  return total / 0.86;
}

fn rounded_aperture(uv_value: vec2f, centered: vec2f, edge_broad: f32, edge_detail: f32) -> f32 {
  let round_distance = length(centered * vec2f(0.92, 1.08));
  let broken_edge = 0.405 + (edge_broad - 0.5) * 0.085 + (edge_detail - 0.5) * 0.036;
  let round_outer = 1.0 - smoothstep(broken_edge - 0.16, broken_edge + 0.12, round_distance);
  let round_center = 1.0 - smoothstep(0.205, 0.295, round_distance);
  let round_alpha = max(round_outer, round_center);
  let border_distance = min(min(uv_value.x, 1.0 - uv_value.x), min(uv_value.y, 1.0 - uv_value.y));
  return round_alpha * smoothstep(0.0, 0.052, border_distance);
}

fn bowl_aperture(uv_value: vec2f, edge_broad: f32, edge_detail: f32) -> f32 {
  let downward = 1.0 - uv_value.y;
  let opening = pow(smoothstep(0.015, 0.92, downward), 0.68);
  let half_width = mix(0.235, 0.6, opening);
  let side_distance = abs(uv_value.x - 0.5) / half_width;
  let stained_side = 0.93 + (edge_broad - 0.5) * 0.16 + (edge_detail - 0.5) * 0.07;
  let side_alpha = 1.0 - smoothstep(stained_side - 0.18, stained_side + 0.16, side_distance);
  let top_alpha = 1.0 - smoothstep(0.78, 1.01, uv_value.y + (edge_broad - 0.5) * 0.035);
  let bottom_edge = 0.045 + (edge_broad - 0.5) * 0.055 + (edge_detail - 0.5) * 0.025;
  let bottom_alpha = smoothstep(bottom_edge - 0.12, bottom_edge + 0.11, uv_value.y);
  let border_distance = min(min(uv_value.x, 1.0 - uv_value.x), min(uv_value.y, 1.0 - uv_value.y));
  return side_alpha * top_alpha * bottom_alpha * smoothstep(0.0, 0.052, border_distance);
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv_value: vec2f,
}

@vertex fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  let position = positions[vertex_index];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv_value = uvs[vertex_index];
  return output;
}
fn linear_to_srgb(color: vec3f) -> vec3f {
  let clamped = clamp(color, vec3f(0.0), vec3f(1.0));
  let low = clamped * 12.92;
  let high = 1.055 * pow(clamped, vec3f(1.0 / 2.4)) - 0.055;
  return select(low, high, clamped > vec3f(0.0031308));
}


@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let uv_value = input.uv_value;
  let effect_uv = vec2f(uv_value.x, 1.0 - uv_value.y);
  let canvas_aspect = params.canvas_size.x / max(params.canvas_size.y, 1.0);
  let image_aspect = params.image_size.x / max(params.image_size.y, 1.0);
  let canvas_is_wider = canvas_aspect > image_aspect;
  let cover_scale = select(
    vec2f(canvas_aspect / image_aspect, 1.0),
    vec2f(1.0, image_aspect / canvas_aspect),
    canvas_is_wider,
  );
  let image_uv = (uv_value - 0.5) * cover_scale + 0.5;
  let source_color = textureSample(image_texture, image_sampler, image_uv);
  let centered = vec2f((effect_uv.x - 0.5) * canvas_aspect * 0.62, effect_uv.y - 0.48);
  let edge_broad = sin(centered.x * 12.7 + centered.y * 7.1) * 0.5 + 0.5;
  let edge_detail = sin(centered.x * 29.3 - centered.y * 18.1 + cos(centered.y * 11.7) * 0.72) * 0.5 + 0.5;
  let base_aperture = select(
    rounded_aperture(effect_uv, centered, edge_broad, edge_detail),
    bowl_aperture(effect_uv, edge_broad, edge_detail),
    params.variant > 0.5,
  );
  let round_distance = length(centered * vec2f(0.92, 1.08));
  let broken_edge = 0.405 + (edge_broad - 0.5) * 0.085 + (edge_detail - 0.5) * 0.036;
  let downward = 1.0 - effect_uv.y;
  let opening = pow(smoothstep(0.015, 0.92, downward), 0.68);
  let half_width = mix(0.235, 0.6, opening);
  let side_distance = abs(effect_uv.x - 0.5) / half_width;
  let stained_side = 0.93 + (edge_broad - 0.5) * 0.16 + (edge_detail - 0.5) * 0.07;
  let bottom_edge = 0.045 + (edge_broad - 0.5) * 0.055 + (edge_detail - 0.5) * 0.025;
  let border_distance = min(min(effect_uv.x, 1.0 - effect_uv.x), min(effect_uv.y, 1.0 - effect_uv.y));

  let fog_space = vec2f((effect_uv.x - 0.5) * canvas_aspect, effect_uv.y - 0.5);
  let light_offset = vec2f((effect_uv.x - 0.78) * canvas_aspect * 0.55, (effect_uv.y - 0.72) * 0.95);
  let light_reach = 1.0 - smoothstep(0.08, 0.92, length(light_offset));
  let phase_alignment = pow(light_reach, 2.2) * 0.72 + 0.28;
  let height_density = 0.38 + exp(effect_uv.y * -1.15) * 0.62;
  let bank_noise = fractal_noise3(vec3f(
    fog_space.x * 0.85 + params.time * 0.03,
    fog_space.y * 1.05 - params.time * 0.012,
    params.time * 0.008,
  ));
  let bank_envelope = smoothstep(0.32, 0.68, bank_noise) * 0.9 + 0.1;

  var ray_transmittance = 1.0;
  var scattered_light = vec3f(0.0);
  for (var step_index = 0; step_index < 5; step_index += 1) {
    let depth = (f32(step_index) + 0.5) / 5.0;
    let volume_position = vec3f(
      fog_space.x * 1.55 + depth * 0.14 + params.time * mix(0.028, 0.052, depth),
      fog_space.y * 1.85 - depth * 0.06 - params.time * mix(0.012, 0.024, depth),
      depth * 1.1 + params.time * mix(0.006, 0.014, depth),
    );
    let broad_noise = fractal_noise3(volume_position * vec3f(1.15, 1.35, 0.72));
    let detail_noise = fractal_noise3(volume_position * vec3f(2.65, 2.2, 1.75) + vec3f(4.1, -2.7, 1.3));
    let billows = broad_noise * 0.78 + detail_noise * 0.22;
    let density = smoothstep(0.4, 0.7, billows) * height_density * (sin(depth * 3.14159265) * 0.24 + 0.76) * bank_envelope * mix(0.82, 1.18, depth);
    let light_probe = noise3((volume_position + vec3f(0.18, 0.14, -0.08)) * vec3f(1.25, 1.35, 0.8));
    let light_visibility = exp(-(density + light_probe * 0.6) * 0.85);
    let direct_scatter = light_visibility * light_reach * phase_alignment;
    let multiple_scatter = min(1.0, direct_scatter + density * 0.22);
    let slice_color = mix(vec3f(0.64, 0.62, 0.59), vec3f(1.0, 0.91, 0.75), multiple_scatter);
    let slice_alpha = 1.0 - exp(density * -0.27);
    scattered_light += slice_color * slice_alpha * ray_transmittance;
    ray_transmittance *= 1.0 - slice_alpha;
  }

  let volume_alpha = 1.0 - ray_transmittance;
  let aperture_shift = (ray_transmittance - 0.55) * 0.12;
  let moving_round_outer = 1.0 - smoothstep(
    broken_edge - 0.16 + aperture_shift,
    broken_edge + 0.12 + aperture_shift,
    round_distance,
  );
  let round_center = 1.0 - smoothstep(0.205, 0.295, round_distance);
  let moving_round_alpha = max(moving_round_outer, round_center);
  let moving_side_alpha = 1.0 - smoothstep(
    stained_side - 0.18 + aperture_shift,
    stained_side + 0.16 + aperture_shift,
    side_distance,
  );
  let moving_top_shift = aperture_shift * 0.45;
  let moving_top_alpha = 1.0 - smoothstep(
    0.78 + moving_top_shift,
    1.01 + moving_top_shift,
    effect_uv.y + (edge_broad - 0.5) * 0.035,
  );
  let moving_bottom_alpha = smoothstep(
    bottom_edge - 0.12 - moving_top_shift,
    bottom_edge + 0.11 - moving_top_shift,
    effect_uv.y,
  );
  let moving_bowl_alpha = moving_side_alpha * moving_top_alpha * moving_bottom_alpha;
  let moving_aperture = mix(moving_round_alpha, moving_bowl_alpha, params.variant) * smoothstep(0.0, 0.052, border_distance);
  let aperture_alpha = base_aperture;
  let revealed_aperture = mix(aperture_alpha, moving_aperture, 0.88);

  let round_fog_outer = 1.0 - smoothstep(broken_edge + 0.08, broken_edge + 0.21, round_distance);
  let bowl_fog_side = 1.0 - smoothstep(stained_side + 0.06, stained_side + 0.22, side_distance);
  let bowl_fog_top = 1.0 - smoothstep(0.94, 1.08, effect_uv.y + (edge_broad - 0.5) * 0.025);
  let bowl_fog_bottom = smoothstep(bottom_edge - 0.14, bottom_edge + 0.045, effect_uv.y);
  let bowl_fog_outer = bowl_fog_side * bowl_fog_top * bowl_fog_bottom;
  let fog_region = mix(round_fog_outer, bowl_fog_outer, params.variant) * smoothstep(0.0, 0.025, border_distance);
  let image_alpha = revealed_aperture * source_color.a;
  let fog_opacity = volume_alpha * fog_region * (1.0 - image_alpha) * 0.88;
  let combined_alpha = min(1.0, image_alpha + fog_opacity);
  let fog_color = scattered_light / max(volume_alpha, 0.0001);
  let resolved_color = (source_color.rgb * image_alpha + fog_color * fog_opacity) / max(combined_alpha, 0.0001);
  return vec4f(linear_to_srgb(resolved_color), combined_alpha);
}
`;

const preferred_format = () =>
  globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";

export const create_vgpu_backend = async (
  canvas,
  { is_alive = () => true, on_lost = () => {} } = {},
) => {
  const api = await import("vgpu");
  if (!is_alive()) return null;
  const gpu = await api.init({ label: "folly-vision-banner" });
  if (!is_alive()) {
    gpu.dispose();
    return null;
  }
  let surface = null;
  let draw = null;
  let sampler = null;
  let texture = null;
  let disposed = false;
  let remove_error = null;
  let lost_handled = false;
  let accepting_loss = false;
  let prepared = false;
  let initialization_error = null;
  const handles = new Set();

  const release = () => {
    if (disposed) return;
    disposed = true;
    remove_error?.();
    remove_error = null;
    for (const handle of handles) handle.dispose();
    handles.clear();
    sampler?.dispose?.();
    sampler = null;
    texture?.dispose?.();
    texture = null;
    draw = null;
    surface?.dispose?.();
    surface = null;
    gpu.dispose();
  };

  const lost = (reason) => {
    if (disposed || lost_handled) return;
    if (!accepting_loss || !prepared) {
      initialization_error = reason;
      return;
    }
    lost_handled = true;
    on_lost(reason);
  };
  gpu.gpu.lost.then(lost);
  remove_error = gpu.onError(lost);

  try {
    surface = api.surface(gpu, canvas, {
      autoResize: false,
      dpr: 1,
      format: preferred_format(),
      alphaMode: "premultiplied",
      colorSpace: "srgb",
      clearColor: [0, 0, 0, 0],
      label: "folly-vision-banner-surface",
    });
    sampler = api.sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    texture = gpu.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm-srgb",
      usage: ["copy_dst", "texture_binding", "render_attachment"],
      label: "folly-vision-banner-image",
    });
    draw = api.draw(gpu, {
      shader: BANNER_SHADER,
      label: "folly-vision-banner",
      blend: "alpha",
      depth: false,
      vertices: 6,
    });
    draw.set({
      params: {
        canvas_size: [1, 1],
        image_size: [1, 1],
        time: 0,
        variant: 0,
      },
      image_texture: texture.view,
      image_sampler: sampler,
    });
    await draw.compile({ colors: [preferred_format()] });
    await gpu.settled();
    if (initialization_error) throw initialization_error;
    if (!is_alive()) {
      release();
      return null;
    }
    accepting_loss = true;
  } catch (error_value) {
    release();
    throw error_value;
  }

  const upload = async (image, width, height) => {
    if (disposed || !image || !width || !height) return;
    if (!texture || texture.size[0] !== width || texture.size[1] !== height) {
      texture?.dispose?.();
      texture = gpu.device.createTexture({
        size: [width, height],
        format: "rgba8unorm-srgb",
        usage: ["copy_dst", "texture_binding", "render_attachment"],
        label: "folly-vision-banner-image",
      });
      draw.set({ image_texture: texture.view });
    }
    gpu.device.pushErrorScope("validation");
    let copy_error = null;
    try {
      gpu.gpu.queue.copyExternalImageToTexture(
        { source: image },
        { texture: texture.gpu, premultipliedAlpha: false },
        { width, height },
      );
    } catch (error_value) {
      copy_error = error_value;
    }
    const validation_error = await gpu.device.popErrorScope();
    if (copy_error) throw copy_error;
    if (validation_error) throw validation_error;
  };
  const backend = {
    canvas,
    backend: "webgpu",
    resize(width, height, dpr = 1) {
      if (disposed) return;
      const physical_width = Math.max(1, Math.round(width * dpr));
      const physical_height = Math.max(1, Math.round(height * dpr));
      surface.resize([physical_width, physical_height]);
    },
    async prepare(captured) {
      if (disposed) return null;
      await upload(captured.image, captured.image_width, captured.image_height);
      const params = {
        canvas_size: [
          Math.max(1, captured.width),
          Math.max(1, captured.height),
        ],
        image_size: [
          Math.max(1, captured.image_width),
          Math.max(1, captured.image_height),
        ],
        time: 0,
        variant: captured.inverted_bowl ? 1 : 0,
      };
      draw.set({ params, image_sampler: sampler });
      await gpu.settled();
      if (initialization_error) throw initialization_error;
      prepared = true;
      const handle = {
        async set_image(image, width, height) {
          if (disposed) return;
          await upload(image, width, height);
          params.image_size = [Math.max(1, width), Math.max(1, height)];
        },
        resize(width, height) {
          params.canvas_size = [Math.max(1, width), Math.max(1, height)];
        },
        dispose() {
          handles.delete(handle);
        },
        _set_time(time_seconds) {
          params.time = time_seconds;
          draw.set({ params });
        },
      };
      handles.add(handle);
      return handle;
    },
    async render(entries, time_seconds) {
      if (disposed || !surface || !draw) return;
      for (const entry of entries ?? []) entry.handle?._set_time(time_seconds);
      api.frame(gpu, (current) => {
        current.pass(surface, (pass) => pass.draw(draw));
      });
      await gpu.settled();
    },
    dispose: release,
  };
  return backend;
};
