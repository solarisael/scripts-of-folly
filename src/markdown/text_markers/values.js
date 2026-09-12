import {
  TEXT_FX_INTENSITY_MIN,
  TEXT_FX_INTENSITY_MAX,
} from "../../js/contract.js";
const text_fx_intensity_min = TEXT_FX_INTENSITY_MIN;
const text_fx_intensity_max = TEXT_FX_INTENSITY_MAX;
const intensity_segment_regex = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/;
const hex_color_regex =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

const normalize_text_fx_intensity_value = (raw_value) => {
  if (typeof raw_value !== "string") {
    return null;
  }

  const parsed_value = Number.parseFloat(raw_value);

  if (!Number.isFinite(parsed_value)) {
    return null;
  }

  const clamped_value = Math.min(
    text_fx_intensity_max,
    Math.max(text_fx_intensity_min, parsed_value),
  );

  return String(clamped_value);
};

// Palette tokens resolve to site custom properties; section defaults keep
// flowing through --site_style_accent when no color is given at all.
const text_fx_palette_color_map = Object.freeze({
  accent: "var(--site_style_accent)",
  accent_alt: "var(--site_style_accent_alt)",
  albedo: "var(--color-albedo)",
  citrinitas: "var(--color-citrinitas)",
  codex: "var(--color-codex)",
  nigredo: "var(--color-nigredo)",
  rubedo: "var(--color-rubedo)",
});

const css_named_color_set = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
    "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
    "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
    "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
    "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
    "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
    "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
    "lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
    "lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace " +
    "olive olivedrab orange orangered orchid palegoldenrod palegreen " +
    "paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown " +
    "salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato " +
    "turquoise violet wheat white whitesmoke yellow yellowgreen " +
    "currentcolor transparent"
  ).split(" "),
);

// "gold" | "#fc0" | "nigredo" -> { token, css } | null. Null means the
// segment is not a known color; the classifier warns and drops it.
const normalize_text_fx_color_value = (raw_value) => {
  if (typeof raw_value !== "string") {
    return null;
  }

  const token = raw_value.trim().toLowerCase();

  if (hex_color_regex.test(token)) {
    return { token, css: token };
  }

  const palette_css = text_fx_palette_color_map[token];

  if (palette_css) {
    return { token, css: palette_css };
  }

  if (css_named_color_set.has(token)) {
    return { token, css: token };
  }

  return null;
};

const intensity_fields = [
  "visual_intensity",
  "motion_intensity",
  "speed_intensity",
];

const assign_marker_intensity = (
  values,
  raw_segment,
  warning_reasons,
  context_label,
) => {
  for (const field of intensity_fields) {
    if (values[field] === null) {
      values[field] = normalize_text_fx_intensity_value(raw_segment);
      return;
    }
  }
  warning_reasons.push(`extra intensity '${raw_segment}'${context_label}`);
  values.invalid = true;
};

const assign_marker_color = (
  values,
  raw_segment,
  warning_reasons,
  context_label,
) => {
  const color_value = normalize_text_fx_color_value(raw_segment);
  if (!color_value) {
    warning_reasons.push(`invalid value '${raw_segment}'${context_label}`);
    values.invalid = true;
    return;
  }
  if (values.color === null) {
    values.color = color_value;
    return;
  }
  warning_reasons.push(`extra color '${raw_segment}'${context_label}`);
  values.invalid = true;
};

const classify_marker_value_segments = (
  raw_segments,
  warning_reasons,
  context_label,
) => {
  const values = {
    visual_intensity: null,
    motion_intensity: null,
    speed_intensity: null,
    color: null,
    invalid: false,
  };
  for (const raw_segment of raw_segments) {
    if (!raw_segment) {
      continue;
    }
    if (intensity_segment_regex.test(raw_segment)) {
      assign_marker_intensity(
        values,
        raw_segment,
        warning_reasons,
        context_label,
      );
    } else {
      assign_marker_color(values, raw_segment, warning_reasons, context_label);
    }
  }
  return values;
};

export { classify_marker_value_segments };
