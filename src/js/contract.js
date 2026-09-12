const TEXT_FX_TEXT_BASE_CLASS = "sol__text_fx";
const TEXT_FX_BLOCK_BASE_CLASS = "sol__block_fx";

const TEXT_FX_TEXT_EFFECT_NAMES = Object.freeze([
  "glow",
  "neon",
  "shadow",
  "chroma",
  "blur",
  "flicker",
  "rainbow",
  "gradient",
  "aura",
  "etch",
  "whisper",
  "sigil_pulse",
  "veil",
  "cadence",
  "cadence_soft",
  "cadence_oracular",
  "cadence_childlike",
  "wiggle",
  "float",
  "shake",
  "glitch",
]);

const TEXT_FX_BLOCK_EFFECT_NAMES = Object.freeze([
  "terminal",
  "stat_screen",
  "game_screen",
  "quest_log",
  "skill_popup",
  "inventory",
  "combat_feed",
  "status_effects",
  "system_warning",
  "memory_fragment",
  "admin_trace",
  "party_roster",
  "map_ping",
]);

const TEXT_FX_INLINE_BLOCK_EFFECT_NAMES = Object.freeze(["combat_feed"]);

const TEXT_FX_STACK_BLACKLIST_PAIRS = Object.freeze([
  Object.freeze(["rainbow", "gradient"]),
  Object.freeze(["shake", "float"]),
]);

const TEXT_FX_INTENSITY_MIN = 0.2;
const TEXT_FX_INTENSITY_MAX = 5;

// Effects whose accent/halo layers accept a color override. Everything else
// either has no color role (motion + cadence effects) or an intentionally
// fixed palette (chroma, rainbow, glitch — the aberration hues ARE the effect).
const TEXT_FX_COLOR_CAPABLE_EFFECT_NAMES = Object.freeze([
  "aura",
  "glow",
  "gradient",
  "neon",
  "shadow",
  "sigil_pulse",
  "veil",
  "whisper",
]);

const TEXT_FX_EFFECT_NAMES = Object.freeze([
  ...TEXT_FX_TEXT_EFFECT_NAMES,
  ...TEXT_FX_BLOCK_EFFECT_NAMES,
]);

const build_effect_class_map = () => {
  const class_map = {};

  for (const effect_name of TEXT_FX_TEXT_EFFECT_NAMES) {
    class_map[effect_name] = `${TEXT_FX_TEXT_BASE_CLASS}_${effect_name}`;
  }

  for (const effect_name of TEXT_FX_BLOCK_EFFECT_NAMES) {
    class_map[effect_name] = `${TEXT_FX_BLOCK_BASE_CLASS}_${effect_name}`;
  }

  return Object.freeze(class_map);
};

const build_effect_kind_map = () => {
  const kind_map = {};

  for (const effect_name of TEXT_FX_TEXT_EFFECT_NAMES) {
    kind_map[effect_name] = "text";
  }

  for (const effect_name of TEXT_FX_BLOCK_EFFECT_NAMES) {
    kind_map[effect_name] = "block";
  }

  return Object.freeze(kind_map);
};

const TEXT_FX_EFFECT_CLASS_MAP = build_effect_class_map();
const TEXT_FX_EFFECT_KIND_MAP = build_effect_kind_map();

const add_aliases = (alias_map, effect_name) => {
  const dash_name = effect_name.replaceAll("_", "-");
  const underscore_name = effect_name.replaceAll("-", "_");
  const class_name = TEXT_FX_EFFECT_CLASS_MAP[effect_name];

  alias_map[effect_name] = effect_name;
  alias_map[dash_name] = effect_name;
  alias_map[underscore_name] = effect_name;
  alias_map[`fx-${dash_name}`] = effect_name;
  alias_map[`fx_${underscore_name}`] = effect_name;
  alias_map[`text_fx_${underscore_name}`] = effect_name;
  alias_map[`block_fx_${underscore_name}`] = effect_name;

  if (class_name) {
    alias_map[class_name] = effect_name;
  }

  if (TEXT_FX_INLINE_BLOCK_EFFECT_NAMES.includes(effect_name)) {
    alias_map[`${TEXT_FX_TEXT_BASE_CLASS}_${effect_name}`] = effect_name;
  }
};

const build_alias_map = () => {
  const alias_map = {};

  for (const effect_name of TEXT_FX_EFFECT_NAMES) {
    add_aliases(alias_map, effect_name);
  }

  return Object.freeze(alias_map);
};

const TEXT_FX_ALIAS_MAP = build_alias_map();

const normalize_text_fx_name = (raw_name) => {
  if (typeof raw_name !== "string") {
    return null;
  }

  const normalized_name = raw_name.trim().toLowerCase();

  if (!normalized_name) {
    return null;
  }

  return TEXT_FX_ALIAS_MAP[normalized_name] ?? null;
};

const text_fx_class_for = (effect_name) => {
  return TEXT_FX_EFFECT_CLASS_MAP[effect_name] ?? null;
};

const text_fx_text_class_for = (effect_name) => {
  return `${TEXT_FX_TEXT_BASE_CLASS}_${effect_name}`;
};

const text_fx_block_class_for = (effect_name) => {
  return `${TEXT_FX_BLOCK_BASE_CLASS}_${effect_name}`;
};

const text_fx_kind_for = (effect_name) => {
  return TEXT_FX_EFFECT_KIND_MAP[effect_name] ?? null;
};

const text_fx_is_text_effect = (effect_name) => {
  return text_fx_kind_for(effect_name) === "text";
};

const text_fx_is_block_effect = (effect_name) => {
  return text_fx_kind_for(effect_name) === "block";
};

const text_fx_is_inline_block_effect = (effect_name) => {
  return TEXT_FX_INLINE_BLOCK_EFFECT_NAMES.includes(effect_name);
};

// interaction layer (Act 2): popup engine vocabulary. Sibling grammar to the
// text/block fx system above, deliberately much smaller — triggers/actions
// are a fixed enum, payload is freeform (no stacking, no intensity, no
// blacklist rules).
const IX_BASE_CLASS = "sol__ix";
const IX_TRIGGER_NAMES = Object.freeze(["hover", "click"]);
const IX_ACTION_NAMES = Object.freeze(["preview", "reveal", "fetch"]);

// "trigger:action:payload" -> { trigger, action, payload } | null.
// Payload is everything after the second colon, so URLs/text containing
// colons of their own survive untouched.
const parse_ix_descriptor = (raw_descriptor) => {
  const raw_value = String(raw_descriptor ?? "");
  const first_colon_index = raw_value.indexOf(":");

  if (first_colon_index === -1) {
    return null;
  }

  const trigger_name = raw_value
    .slice(0, first_colon_index)
    .trim()
    .toLowerCase();
  const remainder = raw_value.slice(first_colon_index + 1);
  const second_colon_index = remainder.indexOf(":");

  if (second_colon_index === -1) {
    return null;
  }

  const action_name = remainder
    .slice(0, second_colon_index)
    .trim()
    .toLowerCase();
  const payload_value = remainder.slice(second_colon_index + 1);

  if (
    !IX_TRIGGER_NAMES.includes(trigger_name) ||
    !IX_ACTION_NAMES.includes(action_name)
  ) {
    return null;
  }

  return { trigger: trigger_name, action: action_name, payload: payload_value };
};

const build_ix_attribute_value = ({ trigger, action, payload }) => {
  return `${trigger}:${action}:${payload}`;
};

export {
  IX_ACTION_NAMES,
  IX_BASE_CLASS,
  IX_TRIGGER_NAMES,
  TEXT_FX_ALIAS_MAP,
  TEXT_FX_BLOCK_BASE_CLASS,
  TEXT_FX_BLOCK_EFFECT_NAMES,
  TEXT_FX_COLOR_CAPABLE_EFFECT_NAMES,
  TEXT_FX_EFFECT_CLASS_MAP,
  TEXT_FX_EFFECT_KIND_MAP,
  TEXT_FX_EFFECT_NAMES,
  TEXT_FX_INLINE_BLOCK_EFFECT_NAMES,
  TEXT_FX_INTENSITY_MAX,
  TEXT_FX_INTENSITY_MIN,
  TEXT_FX_STACK_BLACKLIST_PAIRS,
  TEXT_FX_TEXT_BASE_CLASS,
  TEXT_FX_TEXT_EFFECT_NAMES,
  normalize_text_fx_name,
  text_fx_class_for,
  text_fx_block_class_for,
  text_fx_is_block_effect,
  text_fx_is_inline_block_effect,
  text_fx_is_text_effect,
  text_fx_kind_for,
  text_fx_text_class_for,
  build_ix_attribute_value,
  parse_ix_descriptor,
};
