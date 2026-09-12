import {
  TEXT_FX_EFFECT_CLASS_MAP,
  TEXT_FX_STACK_BLACKLIST_PAIRS,
  normalize_text_fx_name,
  text_fx_is_text_effect,
} from "../contract.js";
const text_fx_effect_class_map = TEXT_FX_EFFECT_CLASS_MAP;
const text_fx_stack_blacklist_pairs = TEXT_FX_STACK_BLACKLIST_PAIRS;

const build_blacklist_lookup = () => {
  const blacklist_lookup = new Map();

  for (const pair of text_fx_stack_blacklist_pairs) {
    const [left_effect, right_effect] = pair;

    if (!blacklist_lookup.has(left_effect)) {
      blacklist_lookup.set(left_effect, new Set());
    }

    if (!blacklist_lookup.has(right_effect)) {
      blacklist_lookup.set(right_effect, new Set());
    }

    blacklist_lookup.get(left_effect).add(right_effect);
    blacklist_lookup.get(right_effect).add(left_effect);
  }

  return blacklist_lookup;
};

const text_fx_stack_blacklist_lookup = build_blacklist_lookup();

const normalize_text_fx_token = (raw_token) => {
  return normalize_text_fx_name(raw_token);
};

const resolve_text_fx_class = (raw_token) => {
  const normalized_effect = normalize_text_fx_token(raw_token);

  if (!normalized_effect) {
    return null;
  }

  return text_fx_effect_class_map[normalized_effect] ?? null;
};

const resolve_text_fx_effects_with_stack_rules = (raw_tokens) => {
  const accepted_effects = [];
  const seen_effects = new Set();

  for (const raw_token of raw_tokens) {
    const normalized_effect = normalize_text_fx_token(raw_token);

    if (!normalized_effect || seen_effects.has(normalized_effect)) {
      continue;
    }

    let is_blocked = false;

    if (text_fx_is_text_effect(normalized_effect)) {
      for (const accepted_effect of accepted_effects) {
        if (
          text_fx_stack_blacklist_lookup
            .get(accepted_effect)
            ?.has(normalized_effect)
        ) {
          is_blocked = true;
          break;
        }
      }
    }

    if (is_blocked) {
      continue;
    }

    accepted_effects.push(normalized_effect);
    seen_effects.add(normalized_effect);
  }

  if (!accepted_effects.includes("combat_feed")) {
    return accepted_effects;
  }

  return [
    "combat_feed",
    ...accepted_effects.filter((effect_name) => effect_name !== "combat_feed"),
  ];
};

const split_text_fx_tokens = (token_string = "") => {
  return token_string
    .split(/[\s,|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

export {
  normalize_text_fx_token,
  resolve_text_fx_class,
  resolve_text_fx_effects_with_stack_rules,
  split_text_fx_tokens,
};
