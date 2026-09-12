const combat_token_class_by_name = Object.freeze({
  crit: "sol__combat_token_crit",
  miss: "sol__combat_token_miss",
  buff: "sol__combat_token_buff",
  debuff: "sol__combat_token_debuff",
  block: "sol__combat_token_block",
  dodge: "sol__combat_token_dodge",
  immune: "sol__combat_token_immune",
  resist: "sol__combat_token_resist",
  mega_crit: "sol__combat_token_mega_crit",
  overkill: "sol__combat_token_overkill",
  true_damage: "sol__combat_token_true_damage",
  guard_break: "sol__combat_token_guard_break",
  execute: "sol__combat_token_execute",
});

const combat_token_regex =
  /\[(MEGA_CRIT|TRUE_DAMAGE|GUARD_BREAK|OVERKILL|EXECUTE|CRIT|MISS|BUFF|DEBUFF|BLOCK|DODGE|IMMUNE|RESIST)\]|\b(MEGA_CRIT|TRUE_DAMAGE|GUARD_BREAK|OVERKILL|EXECUTE|CRIT|MISS|BUFF|DEBUFF|BLOCK|DODGE|IMMUNE|RESIST)\b/gi;

const combat_segment_from_match = (token_match) => {
  const token_value = token_match[1] ?? token_match[2] ?? token_match[0];
  const token_class =
    combat_token_class_by_name[token_value.toLowerCase()] ?? null;

  if (!token_class) {
    return { type: "text", value: token_match[0] };
  }

  const segment = { type: "token", value: token_value, token_class };
  if (token_match[1]) {
    segment.bracketed = true;
  }
  return segment;
};

const parse_combat_token_segments = (text_value) => {
  const raw_text = String(text_value);
  const segments = [];
  let cursor = 0;

  combat_token_regex.lastIndex = 0;

  for (const token_match of raw_text.matchAll(combat_token_regex)) {
    const full_match = token_match[0];
    const token_start = token_match.index ?? 0;
    const token_end = token_start + full_match.length;

    if (cursor < token_start) {
      segments.push({
        type: "text",
        value: raw_text.slice(cursor, token_start),
      });
    }

    segments.push(combat_segment_from_match(token_match));

    cursor = token_end;
  }

  if (cursor < raw_text.length) {
    segments.push({ type: "text", value: raw_text.slice(cursor) });
  }

  return segments;
};

const build_combat_token_fragment = (text_value) => {
  const segments = parse_combat_token_segments(text_value);
  const has_tokens = segments.some(
    (segment_value) => segment_value.type === "token",
  );

  if (!has_tokens || typeof document === "undefined") {
    return null;
  }

  const fragment = document.createDocumentFragment();

  segments.forEach((segment_value) => {
    if (segment_value.type === "text") {
      fragment.append(segment_value.value);
      return;
    }

    const token_span = document.createElement("span");
    token_span.className = `sol__combat_token ${segment_value.token_class}`;

    if (segment_value.bracketed) {
      token_span.classList.add("sol__combat_token_bracketed");

      const open_bracket_span = document.createElement("span");
      open_bracket_span.className = "sol__combat_token_bracket";
      open_bracket_span.textContent = "[";

      const label_span = document.createElement("span");
      label_span.className = "sol__combat_token_label";
      label_span.textContent = segment_value.value;

      const close_bracket_span = document.createElement("span");
      close_bracket_span.className = "sol__combat_token_bracket";
      close_bracket_span.textContent = "]";

      token_span.append(open_bracket_span, label_span, close_bracket_span);
      fragment.append(token_span);
      return;
    }

    token_span.textContent = segment_value.value;
    fragment.append(token_span);
  });

  return fragment;
};

const hydrate_combat_tokens = (root_node = document) => {
  if (!root_node || typeof root_node.querySelectorAll !== "function") {
    return;
  }

  const combat_roots = root_node.querySelectorAll(
    ".sol__block_fx_combat_feed, .sol__text_fx_combat_feed",
  );

  combat_roots.forEach((combat_root) => {
    if (!(combat_root instanceof HTMLElement)) {
      return;
    }

    if (combat_root.dataset.combatTokensHydrated === "true") {
      return;
    }

    const text_walker = document.createTreeWalker(
      combat_root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node_value) => {
          const parent_node = node_value.parentElement;

          if (!parent_node) {
            return NodeFilter.FILTER_REJECT;
          }

          if (
            parent_node.closest(".sol__combat_token") ||
            parent_node.closest("script, style")
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!node_value.textContent || !node_value.textContent.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const candidate_text_nodes = [];

    while (text_walker.nextNode()) {
      candidate_text_nodes.push(text_walker.currentNode);
    }

    candidate_text_nodes.forEach((text_node) => {
      const replacement_fragment = build_combat_token_fragment(
        text_node.textContent ?? "",
      );

      if (!replacement_fragment) {
        return;
      }

      text_node.replaceWith(replacement_fragment);
    });

    combat_root.dataset.combatTokensHydrated = "true";
  });
};

export {
  parse_combat_token_segments,
  build_combat_token_fragment,
  hydrate_combat_tokens,
};
