// Both marker grammars use the same mdast candidates and sibling boundaries.

const escape_html = (raw_value) => {
  return String(raw_value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const is_text_node = (node) => {
  return node?.type === "text" && typeof node.value === "string";
};

const paragraph_only_child = (node) => {
  if (node?.type !== "paragraph") {
    return null;
  }
  if (!Array.isArray(node.children)) {
    return null;
  }
  if (node.children.length !== 1) {
    return null;
  }
  return node.children[0];
};

const marker_candidate_from_child = (child_node) => {
  if (is_text_node(child_node)) {
    return { text: child_node.value, source_kind: "text" };
  }
  const paragraph_child = paragraph_only_child(child_node);
  if (is_text_node(paragraph_child)) {
    return { text: paragraph_child.value, source_kind: "paragraph" };
  }
  return null;
};

const find_sibling_close_marker = (children, start_index, is_close_marker) => {
  for (let index = start_index + 1; index < children.length; index += 1) {
    const candidate = marker_candidate_from_child(children[index]);
    if (candidate && is_close_marker(candidate.text)) {
      return index;
    }
  }
  return -1;
};

const append_wrapped_children = (
  output,
  children,
  start_index,
  close_index,
  opening_html,
  closing_html,
) => {
  output.push({ type: "html", value: opening_html });
  for (let index = start_index + 1; index < close_index; index += 1) {
    output.push(children[index]);
  }
  output.push({ type: "html", value: closing_html });
};

export {
  escape_html,
  marker_candidate_from_child,
  find_sibling_close_marker,
  append_wrapped_children,
};
