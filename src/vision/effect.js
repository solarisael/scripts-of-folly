export const create_vision_banner_effect = ({
  three,
  tsl,
  renderer,
  image,
  image_width,
  image_height,
  inverted_bowl,
}) => {
  const {
    abs,
    cos,
    exp,
    float,
    length,
    max,
    min,
    mix,
    mx_fractal_noise_float,
    mx_noise_float,
    pow,
    select,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
  } = tsl;

  const time = uniform(0);
  const canvas_size = uniform(new three.Vector2(1, 1));
  const image_size = uniform(
    new three.Vector2(image_width || 1, image_height || 1),
  );
  const variant = uniform(inverted_bowl ? 1 : 0);
  const image_texture = new three.Texture(image);
  image_texture.colorSpace = three.SRGBColorSpace;
  image_texture.minFilter = three.LinearFilter;
  image_texture.magFilter = three.LinearFilter;
  image_texture.wrapS = three.ClampToEdgeWrapping;
  image_texture.wrapT = three.ClampToEdgeWrapping;
  image_texture.needsUpdate = true;

  const banner_uv = uv();
  const canvas_aspect = canvas_size.x.div(canvas_size.y);
  const image_aspect = image_size.x.div(image_size.y);
  const canvas_is_wider = canvas_aspect.greaterThan(image_aspect);
  const cover_scale = vec2(
    select(canvas_is_wider, float(1), canvas_aspect.div(image_aspect)),
    select(canvas_is_wider, image_aspect.div(canvas_aspect), float(1)),
  );
  const image_uv = banner_uv.sub(0.5).mul(cover_scale).add(0.5);
  const source_color = texture(image_texture, image_uv);
  const base_color = source_color.rgb;

  const centered = vec2(
    banner_uv.x.sub(0.5).mul(canvas_aspect).mul(0.62),
    banner_uv.y.sub(0.48),
  );
  const edge_broad = sin(centered.x.mul(12.7).add(centered.y.mul(7.1)))
    .mul(0.5)
    .add(0.5);
  const edge_detail = sin(
    centered.x
      .mul(29.3)
      .sub(centered.y.mul(18.1))
      .add(cos(centered.y.mul(11.7)).mul(0.72)),
  )
    .mul(0.5)
    .add(0.5);

  const downward = banner_uv.y.oneMinus();
  const opening = pow(smoothstep(0.015, 0.92, downward), 0.68);
  const half_width = mix(0.235, 0.6, opening);
  const side_distance = abs(banner_uv.x.sub(0.5)).div(half_width);
  const stained_side = float(0.93)
    .add(edge_broad.sub(0.5).mul(0.16))
    .add(edge_detail.sub(0.5).mul(0.07));
  const side_alpha = smoothstep(
    stained_side.sub(0.18),
    stained_side.add(0.16),
    side_distance,
  ).oneMinus();
  const top_alpha = smoothstep(
    0.78,
    1.01,
    banner_uv.y.add(edge_broad.sub(0.5).mul(0.035)),
  ).oneMinus();
  const bottom_edge = float(0.045)
    .add(edge_broad.sub(0.5).mul(0.055))
    .add(edge_detail.sub(0.5).mul(0.025));
  const bottom_alpha = smoothstep(
    bottom_edge.sub(0.12),
    bottom_edge.add(0.11),
    banner_uv.y,
  );
  const inverted_bowl_alpha = side_alpha.mul(top_alpha).mul(bottom_alpha);

  const round_distance = length(centered.mul(vec2(0.92, 1.08)));
  const broken_edge = float(0.405)
    .add(edge_broad.sub(0.5).mul(0.085))
    .add(edge_detail.sub(0.5).mul(0.036));
  const round_outer = smoothstep(
    broken_edge.sub(0.16),
    broken_edge.add(0.12),
    round_distance,
  ).oneMinus();
  const round_center = smoothstep(0.205, 0.295, round_distance).oneMinus();
  const round_alpha = max(round_outer, round_center);
  const border_distance = min(
    min(banner_uv.x, banner_uv.x.oneMinus()),
    min(banner_uv.y, banner_uv.y.oneMinus()),
  );
  const aperture_alpha = mix(round_alpha, inverted_bowl_alpha, variant).mul(
    smoothstep(0, 0.052, border_distance),
  );

  const fog_space = vec2(
    banner_uv.x.sub(0.5).mul(canvas_aspect),
    banner_uv.y.sub(0.5),
  );
  const light_offset = vec2(
    banner_uv.x.sub(0.78).mul(canvas_aspect).mul(0.55),
    banner_uv.y.sub(0.72).mul(0.95),
  );
  const light_reach = smoothstep(0.08, 0.92, length(light_offset)).oneMinus();
  const phase_alignment = pow(light_reach, 2.2).mul(0.72).add(0.28);
  const height_density = float(0.38).add(exp(banner_uv.y.mul(-1.15)).mul(0.62));

  // Five virtual depth slices form a shallow volume around the aperture.
  const bank_noise = mx_fractal_noise_float(
    vec3(
      fog_space.x.mul(0.85).add(time.mul(0.03)),
      fog_space.y.mul(1.05).sub(time.mul(0.012)),
      time.mul(0.008),
    ),
    3,
    2.01,
    0.6,
  )
    .mul(0.5)
    .add(0.5);
  const bank_envelope = smoothstep(0.32, 0.68, bank_noise).mul(0.9).add(0.1);

  const sample_volume_density = (position, depth) => {
    const broad_noise = mx_fractal_noise_float(
      position.mul(vec3(1.15, 1.35, 0.72)),
      3,
      2.03,
      0.58,
    )
      .mul(0.5)
      .add(0.5);
    const detail_noise = mx_fractal_noise_float(
      position.mul(vec3(2.65, 2.2, 1.75)).add(vec3(4.1, -2.7, 1.3)),
      2,
      2.17,
      0.5,
    )
      .mul(0.5)
      .add(0.5);
    const billows = broad_noise.mul(0.78).add(detail_noise.mul(0.22));
    const soft_bank = smoothstep(0.4, 0.7, billows);
    const depth_envelope = sin(depth.mul(Math.PI)).mul(0.24).add(0.76);
    return soft_bank.mul(height_density).mul(depth_envelope).mul(bank_envelope);
  };

  // Integrate scattering and Beer-Lambert transmittance front to back.
  const volume_steps = 5;
  const step_length = 1 / volume_steps;
  let ray_transmittance = float(1);
  let scattered_light = vec3(0);

  for (let step = 0; step < volume_steps; step += 1) {
    const depth = float((step + 0.5) * step_length);
    const volume_position = vec3(
      fog_space.x
        .mul(1.55)
        .add(depth.mul(0.14))
        .add(time.mul(mix(0.028, 0.052, depth))),
      fog_space.y
        .mul(1.85)
        .sub(depth.mul(0.06))
        .sub(time.mul(mix(0.012, 0.024, depth))),
      depth.mul(1.1).add(time.mul(mix(0.006, 0.014, depth))),
    );
    const density = sample_volume_density(volume_position, depth).mul(
      mix(0.82, 1.18, depth),
    );
    const light_probe_density = mx_noise_float(
      volume_position.add(vec3(0.18, 0.14, -0.08)).mul(vec3(1.25, 1.35, 0.8)),
    )
      .mul(0.5)
      .add(0.5);
    const light_visibility = exp(
      density.add(light_probe_density.mul(0.6)).mul(-0.85),
    );
    const direct_scatter = light_visibility
      .mul(light_reach)
      .mul(phase_alignment);
    const multiple_scatter = min(1, direct_scatter.add(density.mul(0.22)));
    const slice_color = mix(
      vec3(0.64, 0.62, 0.59),
      vec3(1, 0.91, 0.75),
      multiple_scatter,
    );
    const slice_alpha = exp(density.mul(step_length * -1.35)).oneMinus();

    scattered_light = scattered_light.add(
      slice_color.mul(slice_alpha).mul(ray_transmittance),
    );
    ray_transmittance = ray_transmittance.mul(slice_alpha.oneMinus());
  }

  const aperture_shift = ray_transmittance.sub(0.55).mul(0.12);
  const moving_round_outer = smoothstep(
    broken_edge.sub(0.16).add(aperture_shift),
    broken_edge.add(0.12).add(aperture_shift),
    round_distance,
  ).oneMinus();
  const moving_round_alpha = max(moving_round_outer, round_center);
  const moving_side_alpha = smoothstep(
    stained_side.sub(0.18).add(aperture_shift),
    stained_side.add(0.16).add(aperture_shift),
    side_distance,
  ).oneMinus();
  const moving_top_shift = aperture_shift.mul(0.45);
  const moving_top_alpha = smoothstep(
    float(0.78).add(moving_top_shift),
    float(1.01).add(moving_top_shift),
    banner_uv.y.add(edge_broad.sub(0.5).mul(0.035)),
  ).oneMinus();
  const moving_bottom_alpha = smoothstep(
    bottom_edge.sub(0.12).sub(moving_top_shift),
    bottom_edge.add(0.11).sub(moving_top_shift),
    banner_uv.y,
  );
  const moving_inverted_bowl_alpha = moving_side_alpha
    .mul(moving_top_alpha)
    .mul(moving_bottom_alpha);
  const moving_aperture_alpha = mix(
    moving_round_alpha,
    moving_inverted_bowl_alpha,
    variant,
  ).mul(smoothstep(0, 0.052, border_distance));
  const revealed_aperture_alpha = mix(
    aperture_alpha,
    moving_aperture_alpha,
    0.88,
  );

  const round_fog_outer = smoothstep(
    broken_edge.add(0.08),
    broken_edge.add(0.21),
    round_distance,
  ).oneMinus();
  const bowl_fog_side = smoothstep(
    stained_side.add(0.06),
    stained_side.add(0.22),
    side_distance,
  ).oneMinus();
  const bowl_fog_top = smoothstep(
    0.94,
    1.08,
    banner_uv.y.add(edge_broad.sub(0.5).mul(0.025)),
  ).oneMinus();
  const bowl_fog_bottom = smoothstep(
    bottom_edge.sub(0.14),
    bottom_edge.add(0.045),
    banner_uv.y,
  );
  const bowl_fog_outer = bowl_fog_side.mul(bowl_fog_top).mul(bowl_fog_bottom);
  const fog_region = mix(round_fog_outer, bowl_fog_outer, variant).mul(
    smoothstep(0, 0.025, border_distance),
  );
  const volume_alpha = ray_transmittance.oneMinus();
  const image_alpha = revealed_aperture_alpha.mul(source_color.a);
  const fog_opacity = volume_alpha
    .mul(fog_region)
    .mul(image_alpha.oneMinus())
    .mul(0.88);
  const combined_alpha = min(1, image_alpha.add(fog_opacity));
  const resolved_fog_color = scattered_light.div(max(volume_alpha, 0.0001));
  const premultiplied_color = base_color
    .mul(image_alpha)
    .add(resolved_fog_color.mul(fog_opacity));
  const fog_color = premultiplied_color.div(max(combined_alpha, 0.0001));

  const material = new three.MeshBasicNodeMaterial();
  material.colorNode = fog_color;
  material.opacityNode = combined_alpha;
  material.transparent = true;
  material.premultipliedAlpha = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;

  const geometry = new three.PlaneGeometry(2, 2);
  const mesh = new three.Mesh(geometry, material);
  const scene = new three.Scene();
  const camera = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(mesh);
  renderer.setClearColor(0x000000, 0);

  let disposed = false;
  return {
    resize: ({ width, height }) => {
      canvas_size.value.set(width, height);
    },
    set_image: (next_image, width, height) => {
      if (disposed) return;
      image_texture.image = next_image;
      image_texture.needsUpdate = true;
      image_size.value.set(width || 1, height || 1);
    },
    render: ({ elapsed_seconds }) => {
      if (disposed) return;
      time.value = elapsed_seconds;
      renderer.render(scene, camera);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scene.remove(mesh);
      image_texture.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
};
