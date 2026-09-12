import {
  resolve_text_fx_effects_with_stack_rules,
  split_text_fx_tokens,
} from "../js/text/normalization.js";

const FX_SOURCE_SELECTOR =
  ".sol__text_fx, .sol__block_fx, [data-text-fx], [class*='fx-']";
const GENERATED_ATTRIBUTES = new Set([
  "data-folly-gpu-text",
  "data-folly-gpu-panel",
  "data-folly-capture",
  "data-text-fx-hydrated",
  "data-combat-tokens-hydrated",
  "data-sol-pretext-hydrated",
  "data-sol-pretext-shape-hydrated",
]);
const GENERATED_CLASS_NAMES = new Set([
  "sol__pretext_justified",
  "sol__pretext_line",
  "sol__pretext_fragment",
  "sol__pretext_shaped",
  "sol__pretext_transitioning",
]);
const FX_ATTRIBUTE_RE = /^data-text-fx(?:-|$)/u;
const STYLE_PROPERTY_RE =
  /^(--(?:text|block)_fx_[a-z0-9_-]+|font(?:-[a-z-]+)?|letter-spacing|line-height|color|-webkit-text-fill-color)$/iu;

export const split_text_for_pretext_items = (text_value) => {
  const source = String(text_value ?? "");
  const tokens = [];
  let pending_space = "";

  for (const match of source.matchAll(/\s+|\S+/gu)) {
    const token = match[0];
    if (/^\s+$/u.test(token)) {
      pending_space = " ";
      continue;
    }
    tokens.push(`${pending_space}${token}`);
    pending_space = "";
  }

  return { tokens, pendingSpace: pending_space };
};

const read_font_shorthand = (style) =>
  style.font ||
  `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

const read_letter_spacing = (style) => {
  const value = Number.parseFloat(style.letterSpacing);
  return Number.isFinite(value) ? value : 0;
};

const is_generated_attribute = (name) =>
  GENERATED_ATTRIBUTES.has(name) ||
  name.startsWith("data-folly-") ||
  name.startsWith("data-sol-pretext-");

const is_generated_class = (name) => GENERATED_CLASS_NAMES.has(name);
const is_fx_class = (name) =>
  ["sol__text_fx", "sol__block_fx", "fx-"].some((prefix) =>
    name.startsWith(prefix),
  );
const safe_attributes = (element) => {
  const attributes = {};
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();
    if (
      is_generated_attribute(name) ||
      name === "style" ||
      FX_ATTRIBUTE_RE.test(name)
    ) {
      continue;
    }
    if (name === "class") {
      const classes = attribute.value
        .split(/\s+/u)
        .filter(
          (value) => value && !is_fx_class(value) && !is_generated_class(value),
        );
      if (classes.length) attributes.class = classes.join(" ");
      continue;
    }
    if (name.startsWith("on") || name === "srcdoc") continue;
    if (
      name === "href" ||
      name === "target" ||
      name === "rel" ||
      name === "title" ||
      name === "lang" ||
      name === "dir" ||
      name === "tabindex" ||
      name.startsWith("aria-") ||
      name === "role" ||
      name.startsWith("data-")
    ) {
      attributes[name] = attribute.value;
    }
  }
  return attributes;
};

const safe_inline_style = (element) => {
  const style = {};
  for (const property of element.style) {
    if (STYLE_PROPERTY_RE.test(property))
      style[property] = element.style.getPropertyValue(property);
  }
  return style;
};

const descriptor_for = (element) => ({
  tag: element.localName,
  attributes: safe_attributes(element),
  style: safe_inline_style(element),
});

const collect_ancestors = (root, element) => {
  const ancestors = [];
  let current = element;
  while (current && current !== root) {
    if (current.nodeType === 1) ancestors.unshift(current);
    current = current.parentElement;
  }
  return ancestors;
};

const collect_fx_attributes = (ancestors) => {
  const classes = [];
  const data_tokens = [];
  const attributes = {};
  const styles = {};

  for (const element of ancestors) {
    if (element.matches(FX_SOURCE_SELECTOR)) {
      for (const value of element.classList) {
        if (is_fx_class(value)) classes.push(value);
      }
      for (const attribute of element.attributes) {
        const name = attribute.name.toLowerCase();
        if (FX_ATTRIBUTE_RE.test(name) && !is_generated_attribute(name)) {
          attributes[name] = attribute.value;
          if (name === "data-text-fx") data_tokens.push(attribute.value);
        }
      }
      Object.assign(styles, safe_inline_style(element));
    }
  }

  const effect_names = resolve_text_fx_effects_with_stack_rules([
    ...classes,
    ...data_tokens.flatMap((value) => split_text_fx_tokens(value)),
  ]);
  if (effect_names.length && !classes.includes("sol__text_fx"))
    classes.unshift("sol__text_fx");
  if (effect_names.length) attributes["data-text-fx"] = effect_names.join(" ");
  if (classes.length) attributes.class = [...new Set(classes)].join(" ");
  return { attributes, styles, effect_names };
};
const push_text_items = ({
  items,
  metadata,
  text,
  styleElement,
  ancestors,
  pendingSpaceRef,
}) => {
  const { tokens, pendingSpace } = split_text_for_pretext_items(
    `${pendingSpaceRef.value}${text}`,
  );
  pendingSpaceRef.value = pendingSpace;
  if (!tokens.length) return;

  const style =
    styleElement.ownerDocument.defaultView.getComputedStyle(styleElement);
  const fx = collect_fx_attributes(ancestors);
  const wrappers = ancestors.map(descriptor_for);
  const computed = {
    font: read_font_shorthand(style),
    letterSpacing: `${read_letter_spacing(style)}px`,
    color: style.color,
    textFillColor: style.webkitTextFillColor,
  };
  for (const token of tokens) {
    items.push({
      text: token,
      font: computed.font,
      letterSpacing: Number.parseFloat(computed.letterSpacing) || 0,
    });
    metadata.push({
      attributes: fx.attributes,
      styles: { ...computed, ...fx.styles },
      wrappers,
      effect_names: fx.effect_names,
    });
  }
};

const snapshot_source_html = (root) => {
  const clone = root.cloneNode(true);
  const clean = (element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (is_generated_attribute(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "class" && typeof element.className === "string") {
        const classes = element.className
          .split(/\s+/u)
          .filter((value) => value && !is_generated_class(value));
        if (classes.length) element.className = classes.join(" ");
        else element.removeAttribute("class");
      }
    }
    for (const child of Array.from(element.children)) clean(child);
  };
  clean(clone);
  return clone.innerHTML;
};

export const extract_pretext_source = (root) => {
  const items = [];
  const metadata = [];
  const pendingSpaceRef = { value: "" };
  const textNode = root.ownerDocument.defaultView.Node.TEXT_NODE;
  const elementNode = root.ownerDocument.defaultView.Node.ELEMENT_NODE;

  const walk = (node, ancestors, styleElement) => {
    if (node.nodeType === textNode) {
      push_text_items({
        items,
        metadata,
        text: node.textContent ?? "",
        styleElement,
        ancestors,
        pendingSpaceRef,
      });
      return;
    }
    if (node.nodeType !== elementNode) return;
    if (node.matches("script, style")) return;
    const nextAncestors = [...ancestors, node];
    for (const child of node.childNodes) walk(child, nextAncestors, node);
  };

  for (const child of root.childNodes) walk(child, [], root);
  return {
    items,
    metadata,
    prepared: null,
    signature: null,
    author_html: snapshot_source_html(root),
  };
};
