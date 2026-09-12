import {
  TEXT_FX_TEXT_EFFECT_NAMES,
  TEXT_FX_BLOCK_EFFECT_NAMES,
  TEXT_FX_INLINE_BLOCK_EFFECT_NAMES,
  TEXT_FX_STACK_BLACKLIST_PAIRS,
  TEXT_FX_COLOR_CAPABLE_EFFECT_NAMES,
  normalize_text_fx_name,
} from "../../js/contract.js";
import { classify_marker_value_segments } from "./values.js";
const text_fx_effect_names = TEXT_FX_TEXT_EFFECT_NAMES;
const text_fx_block_effect_names = TEXT_FX_BLOCK_EFFECT_NAMES;
const text_fx_inline_block_effect_names = TEXT_FX_INLINE_BLOCK_EFFECT_NAMES;
const text_fx_inline_block_effect_name_set = new Set(
  text_fx_inline_block_effect_names,
);

const text_fx_effect_name_set = new Set(text_fx_effect_names);
const text_fx_block_effect_name_set = new Set(text_fx_block_effect_names);
const text_fx_stack_blacklist_pairs = TEXT_FX_STACK_BLACKLIST_PAIRS;
const text_fx_color_capable_effect_name_set = new Set(
  TEXT_FX_COLOR_CAPABLE_EFFECT_NAMES,
);
const marker_effect_token_regex = /^([a-z0-9_-]+)(?:=([a-z0-9_.#/-]+))?$/i;

const build_blacklist_lookup = () => {
  const lookup = new Map();

  for (const pair of text_fx_stack_blacklist_pairs) {
    const [left_effect, right_effect] = pair;

    if (!lookup.has(left_effect)) {
      lookup.set(left_effect, new Set());
    }

    if (!lookup.has(right_effect)) {
      lookup.set(right_effect, new Set());
    }

    lookup.get(left_effect).add(right_effect);
    lookup.get(right_effect).add(left_effect);
  }

  return lookup;
};

const text_fx_stack_blacklist_lookup = build_blacklist_lookup();

const normalize_effect_stack_for_output = (effect_names) => {
  if (!Array.isArray(effect_names) || !effect_names.length) {
    return [];
  }

  if (!effect_names.includes("combat_feed")) {
    return effect_names;
  }

  return [
    "combat_feed",
    ...effect_names.filter((effect_name) => effect_name !== "combat_feed"),
  ];
};

const parse_marker_effect_token = (raw_effect_token, warning_reasons) => {
  const token_match = raw_effect_token.match(marker_effect_token_regex);

  if (!token_match) {
    return null;
  }

  const [, raw_effect_name, raw_effect_values] = token_match;
  const effect_name = normalize_text_fx_name(raw_effect_name);

  if (!effect_name) {
    return null;
  }

  const {
    visual_intensity,
    motion_intensity,
    speed_intensity,
    color,
    invalid,
  } = classify_marker_value_segments(
    raw_effect_values ? raw_effect_values.split("/") : [],
    warning_reasons,
    ` in '${raw_effect_token}'`,
  );

  if (invalid) {
    return null;
  }

  if (color && !text_fx_color_capable_effect_name_set.has(effect_name)) {
    warning_reasons.push(
      `color '${color.token}' dropped: '${effect_name}' has no color channel`,
    );

    return {
      effect_name,
      visual_intensity,
      motion_intensity,
      speed_intensity,
      color: null,
    };
  }

  return {
    effect_name,
    visual_intensity,
    motion_intensity,
    speed_intensity,
    color,
  };
};

const blocking_effect_in_stack = (effect_name, accepted_effect_names) => {
  for (const accepted_effect_name of accepted_effect_names) {
    if (
      text_fx_stack_blacklist_lookup.get(accepted_effect_name)?.has(effect_name)
    ) {
      return accepted_effect_name;
    }
  }
  return null;
};

const store_effect_settings = (effect_settings, parsed_token) => {
  const {
    effect_name,
    visual_intensity,
    motion_intensity,
    speed_intensity,
    color,
  } = parsed_token;
  if (
    visual_intensity != null ||
    motion_intensity != null ||
    speed_intensity != null ||
    color != null
  ) {
    effect_settings[effect_name] = {
      visual_intensity,
      motion_intensity,
      speed_intensity,
      color,
    };
  }
};

const accept_effect_token = (parsed_token, stack) => {
  const { effect_name } = parsed_token;
  stack.accepted_effect_names.push(effect_name);
  stack.seen_effect_names.add(effect_name);
  store_effect_settings(stack.effect_settings, parsed_token);
};

const accept_block_stack_token = (parsed_token, stack) => {
  const { effect_name } = parsed_token;
  if (text_fx_inline_block_effect_name_set.has(effect_name)) {
    accept_effect_token(parsed_token, stack);
    return;
  }
  stack.warning_reasons.push(
    `block token '${effect_name}' is not allowed in stacks`,
  );
};

const append_effect_token = (raw_token, token_count, stack) => {
  const parsed_token = parse_marker_effect_token(
    raw_token,
    stack.warning_reasons,
  );
  if (!parsed_token) {
    stack.warning_reasons.push(`invalid token '${raw_token}'`);
    return;
  }
  const { effect_name } = parsed_token;
  if (stack.seen_effect_names.has(effect_name)) {
    stack.warning_reasons.push(`duplicate token '${effect_name}'`);
    return;
  }
  if (token_count > 1 && text_fx_block_effect_name_set.has(effect_name)) {
    accept_block_stack_token(parsed_token, stack);
    return;
  }
  const blocked_by = blocking_effect_in_stack(
    effect_name,
    stack.accepted_effect_names,
  );
  if (blocked_by) {
    stack.warning_reasons.push(
      `'${effect_name}' dropped because '${blocked_by}+${effect_name}' is blacklisted`,
    );
    return;
  }
  accept_effect_token(parsed_token, stack);
};

const normalize_stack_color = (color, effect_names, warning_reasons) => {
  if (!color) {
    return color;
  }
  if (
    effect_names.some((effect_name) =>
      text_fx_color_capable_effect_name_set.has(effect_name),
    )
  ) {
    return color;
  }
  warning_reasons.push(
    `color '${color.token}' dropped: no color-capable effect in stack`,
  );
  return null;
};

const parse_marker_effect_descriptor = (raw_descriptor) => {
  if (typeof raw_descriptor !== "string") {
    return null;
  }
  const segments = raw_descriptor
    .trim()
    .toLowerCase()
    .split(":")
    .map((segment) => segment.trim());
  const raw_effect_tokens = segments[0];
  if (!raw_effect_tokens) {
    return null;
  }
  const effect_tokens = raw_effect_tokens
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean);
  const stack = {
    warning_reasons: [],
    accepted_effect_names: [],
    effect_settings: {},
    seen_effect_names: new Set(),
  };
  for (const effect_token of effect_tokens) {
    append_effect_token(effect_token, effect_tokens.length, stack);
  }
  if (!stack.accepted_effect_names.length) {
    return null;
  }
  const values = classify_marker_value_segments(
    segments.slice(1),
    stack.warning_reasons,
    "",
  );
  if (values.invalid) {
    return null;
  }
  return {
    effect_names: normalize_effect_stack_for_output(
      stack.accepted_effect_names,
    ),
    effect_settings: stack.effect_settings,
    visual_intensity: values.visual_intensity,
    motion_intensity: values.motion_intensity,
    speed_intensity: values.speed_intensity,
    color: normalize_stack_color(
      values.color,
      stack.accepted_effect_names,
      stack.warning_reasons,
    ),
    warning_reasons: stack.warning_reasons,
    raw_descriptor,
  };
};

const emit_sanitization_warning = (
  warning_reasons,
  raw_descriptor,
  effect_names,
  warn,
  warning_cache,
) => {
  if (!warning_reasons.length || typeof warn !== "function") {
    return;
  }

  const cache_key = `${raw_descriptor}|${warning_reasons.join("|")}`;

  if (warning_cache?.has(cache_key)) {
    return;
  }

  warning_cache?.add(cache_key);
  warn(
    `[sol__text_fx] auto-sanitized marker '${raw_descriptor}' -> '${effect_names.join("|")}' (${warning_reasons.join("; ")})`,
  );
};

const is_inline_stack_effect = (effect_name) => {
  return (
    text_fx_effect_name_set.has(effect_name) ||
    text_fx_inline_block_effect_name_set.has(effect_name)
  );
};

export {
  parse_marker_effect_descriptor,
  emit_sanitization_warning,
  is_inline_stack_effect,
  text_fx_effect_names,
  text_fx_block_effect_names,
  text_fx_inline_block_effect_names,
};
