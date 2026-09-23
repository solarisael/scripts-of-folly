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

export function gaussian_alpha(_tsl, sample, uv, radius) {
  return sample(uv, radius).a;
}

export function gaussian_rgba(_tsl, sample, uv, radius) {
  return sample(uv, radius);
}
