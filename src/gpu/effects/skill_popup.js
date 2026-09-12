export function build_effect(context) {
  const { tsl, uv, params } = context;
  const phase = tsl.sin(params.time.mul(params.speed).mul(2.4183991523));
  const pulse = tsl.float(0.82).add(phase.mul(0.18).mul(params.motion));
  const edge_x = uv.x.min(tsl.float(1).sub(uv.x));
  const edge_y = uv.y.min(tsl.float(1).sub(uv.y));
  const edge = edge_x.min(edge_y);
  const aspect = params.size.x.div(params.size.y.max(1));
  const width = tsl.float(0.018).mul(aspect.clamp(0.45, 1.8));
  const halo = tsl.smoothstep(width.mul(3.8), 0, edge);
  const core = tsl.smoothstep(width, 0, edge);
  const alpha = halo
    .mul(pulse)
    .mul(params.intensity)
    .mul(0.46)
    .add(core.mul(params.intensity).mul(0.22))
    .clamp(0, 0.82);
  return { uv, rgba: tsl.vec4(params.accent, alpha) };
}
