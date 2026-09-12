export function clamp_alpha(tsl, alpha) {
  return tsl.clamp(alpha, tsl.float(0), tsl.float(1));
}

export function over(tsl, under, color, alpha) {
  const source_alpha = clamp_alpha(tsl, alpha);
  const under_alpha = clamp_alpha(tsl, under.a);
  const output_alpha = clamp_alpha(
    tsl,
    source_alpha.add(under_alpha.mul(tsl.float(1).sub(source_alpha))),
  );
  const source_premultiplied = color.mul(source_alpha);
  const under_premultiplied = under.rgb.mul(
    under_alpha.mul(tsl.float(1).sub(source_alpha)),
  );
  const output_color = source_premultiplied
    .add(under_premultiplied)
    .div(tsl.max(output_alpha, tsl.float(0.00001)));
  return tsl.vec4(output_color, output_alpha);
}

export function behind(tsl, current, color, alpha) {
  return over(
    tsl,
    tsl.vec4(color, clamp_alpha(tsl, alpha)),
    current.rgb,
    current.a,
  );
}

function kernel_offsets(x, y) {
  return [
    [0, 0, 0.24],
    [x, 0, 0.11],
    [x.negate(), 0, 0.11],
    [0, y, 0.11],
    [0, y.negate(), 0.11],
    [x, y, 0.05],
    [x.negate(), y, 0.05],
    [x, y.negate(), 0.05],
    [x.negate(), y.negate(), 0.05],
    [x.mul(2), 0, 0.03],
    [x.mul(-2), 0, 0.03],
    [0, y.mul(2), 0.03],
    [0, y.mul(-2), 0.03],
  ];
}

export function gaussian_alpha(tsl, sample, uv, radius) {
  let result = tsl.float(0);
  for (const [offset_x, offset_y, weight] of kernel_offsets(
    radius.x,
    radius.y,
  )) {
    const point = tsl.vec2(
      typeof offset_x === "number" ? tsl.float(offset_x) : offset_x,
      typeof offset_y === "number" ? tsl.float(offset_y) : offset_y,
    );
    result = result.add(sample(uv.add(point)).a.mul(tsl.float(weight)));
  }
  return result;
}

export function gaussian_rgba(tsl, sample, uv, radius) {
  let premultiplied = tsl.vec3(0, 0, 0);
  let alpha = tsl.float(0);
  for (const [offset_x, offset_y, weight] of kernel_offsets(
    radius.x,
    radius.y,
  )) {
    const point = tsl.vec2(
      typeof offset_x === "number" ? tsl.float(offset_x) : offset_x,
      typeof offset_y === "number" ? tsl.float(offset_y) : offset_y,
    );
    const source = sample(uv.add(point));
    const contribution = source.a.mul(tsl.float(weight));
    premultiplied = premultiplied.add(source.rgb.mul(contribution));
    alpha = alpha.add(contribution);
  }
  return tsl.vec4(premultiplied.div(tsl.max(alpha, tsl.float(0.00001))), alpha);
}
