export const compute_justified_gap_extra = ({
  lineWidth,
  targetWidth,
  gapCount,
  isLastLine,
}) => {
  if (isLastLine || gapCount <= 0 || targetWidth <= lineWidth) return 0;

  return (targetWidth - lineWidth) / gapCount;
};

const count_justifiable_gaps = (line) => {
  let count = 0;

  for (let index = 1; index < line.fragments.length; index += 1) {
    if (line.fragments[index].gapBefore > 0) count += 1;
  }

  return count;
};

const apply_attributes = (element, attributes = {}, styles = {}) => {
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "class") element.className = value;
    else element.setAttribute(name, value);
  }

  for (const [name, value] of Object.entries(styles)) {
    const css_name =
      name === "textFillColor"
        ? "-webkit-text-fill-color"
        : name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    if (value != null && value !== "")
      element.style.setProperty(css_name, value);
  }
};

const build_fragment = (doc, text, meta) => {
  const fragment = doc.createElement("span");
  apply_attributes(fragment, meta?.attributes, meta?.styles);
  fragment.classList.add("sol__pretext_fragment");
  fragment.dataset.solPretextItem = String(meta?.itemIndex ?? "");
  fragment.textContent = text;

  let node = fragment;
  const wrappers = meta?.wrappers ?? [];

  for (let index = wrappers.length - 1; index >= 0; index -= 1) {
    const descriptor = wrappers[index];
    const wrapper = doc.createElement(descriptor.tag || "span");
    apply_attributes(wrapper, descriptor.attributes, descriptor.style);
    wrapper.append(node);
    node = wrapper;
  }

  return { node, fragment };
};

const emit_layout_event = (root, name) => {
  const view = root.ownerDocument.defaultView;
  if (typeof view?.CustomEvent !== "function") return;

  root.dispatchEvent(
    new view.CustomEvent(name, { bubbles: true, detail: { root } }),
  );
};

export const render_pretext_lines = ({
  root,
  lines,
  metadata = [],
  width,
  shape = null,
}) => {
  const doc = root.ownerDocument;
  const rendered_nodes = [];

  for (let line_index = 0; line_index < lines.length; line_index += 1) {
    const line = lines[line_index];
    const is_last_line = line_index === lines.length - 1;
    const line_width = line.targetWidth ?? width;
    const gap_extra = compute_justified_gap_extra({
      lineWidth: line.width,
      targetWidth: line_width,
      gapCount: count_justifiable_gaps(line),
      isLastLine: is_last_line,
    });

    const line_element = doc.createElement("span");
    line_element.className = "sol__pretext_line";
    line_element.dataset.solPretextLine = String(line_index + 1);
    line_element.dataset.solPretextJustified = String(gap_extra > 0);
    line_element.style.width = `${line_width}px`;
    line_element.style.maxWidth = "100%";

    for (
      let fragment_index = 0;
      fragment_index < line.fragments.length;
      fragment_index += 1
    ) {
      const fragment = line.fragments[fragment_index];
      const meta = metadata[fragment.itemIndex] ?? null;
      const should_add_gap = fragment_index > 0 && fragment.gapBefore > 0;
      const built = build_fragment(
        doc,
        should_add_gap ? ` ${fragment.text}` : fragment.text,
        {
          ...meta,
          itemIndex: fragment.itemIndex,
        },
      );

      if (should_add_gap && gap_extra > 0)
        built.fragment.style.marginInlineStart = `${gap_extra}px`;
      line_element.append(built.node);
    }

    rendered_nodes.push(line_element, doc.createTextNode("\n"));
  }

  root.classList.add("sol__pretext_justified");
  root.classList.toggle("sol__pretext_shaped", Boolean(shape));
  root.dataset.solPretextHydrated = "true";
  if (shape) root.dataset.solPretextShapeHydrated = shape;
  else delete root.dataset.solPretextShapeHydrated;

  root.replaceChildren(...rendered_nodes);
  emit_layout_event(root, "folly:pretext-layout");
};
