const MIN_CHANNEL = 0.2;
const MAX_CHANNEL = 5;
const color_canvases = new WeakMap();

function clamp_channel(value) {
  const numeric_value = Number(value);
  if (!Number.isFinite(numeric_value)) return 1;
  return Math.min(MAX_CHANNEL, Math.max(MIN_CHANNEL, numeric_value));
}

function channel_value(style, effect_name, channel_name) {
  const effect_value = style
    .getPropertyValue(`--text_fx_${effect_name}_${channel_name}`)
    .trim();
  const text_marker = style
    .getPropertyValue(`--text_fx_marker_${channel_name}`)
    .trim();
  const block_marker = style
    .getPropertyValue(`--block_fx_marker_${channel_name}`)
    .trim();
  return clamp_channel(effect_value || text_marker || block_marker || 1);
}

function css_multiplier(style, property_name) {
  const value = Number.parseFloat(style.getPropertyValue(property_name));
  return Number.isFinite(value) ? value : 1;
}

function color_probe(element, value) {
  const document_value = element.ownerDocument;
  const probe = document_value.createElement("span");
  probe.dataset.follyProbe = "";
  probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "width:1px",
    "height:1px",
    `color:${value}`,
  ].join(";");
  element.append(probe);
  try {
    return document_value.defaultView.getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

function color_value(element, value, fallback_value = null) {
  const document_value = element.ownerDocument;
  const resolved_value = color_probe(element, value);
  let canvas = color_canvases.get(document_value);
  if (!canvas) {
    canvas = document_value.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    color_canvases.set(document_value, canvas);
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0];
  context.fillStyle = resolved_value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0 && fallback_value && fallback_value !== value) {
    return color_value(element, fallback_value);
  }
  return [red / 255, green / 255, blue / 255];
}

export function read_effect_parameters(element, effect_name, captured) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const intensity = channel_value(style, effect_name, "intensity");
  const glow_multiplier = css_multiplier(style, "--site_fx_glow_mult");
  const motion_multiplier = css_multiplier(style, "--site_fx_motion_mult");
  const motion =
    channel_value(style, effect_name, "motion") * motion_multiplier;
  const speed = channel_value(style, effect_name, "speed") * motion_multiplier;
  const effect_color = style
    .getPropertyValue(`--text_fx_${effect_name}_color`)
    .trim();
  const marker_color = style.getPropertyValue("--text_fx_marker_color").trim();
  const accent = color_value(
    element,
    effect_color || marker_color || "var(--site_style_accent, currentColor)",
  );
  const base_css = captured?.base_color || style.color || "currentColor";
  const base_color = color_value(
    element,
    base_css,
    style.color || "currentColor",
  );
  const rect = element.getBoundingClientRect();
  const size = [captured?.width ?? rect.width, captured?.height ?? rect.height];
  const font_size =
    captured?.font_size ?? (Number.parseFloat(style.fontSize) || 16);

  return {
    intensity: intensity * glow_multiplier,
    motion,
    speed,
    accent,
    color_override: Boolean(effect_color || marker_color),
    base_color,
    size,
    font_size,
  };
}
