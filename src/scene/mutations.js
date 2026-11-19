const COMPOSITION = new Set([
  "opacity",
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "scale",
  "z-index",
]);
const SURFACE_ATTRIBUTES = new Set([
  "style",
  "class",
  "width",
  "height",
  "hidden",
]);
const previous_styles = new WeakMap();

function composition_style(record) {
  const doc = record.target.ownerDocument;
  let previous = previous_styles.get(doc);
  if (!previous) {
    previous = doc.createElement("span").style;
    previous_styles.set(doc, previous);
  }
  previous.cssText = record.oldValue || "";
  const current = record.target.style;
  const unchanged = (name) =>
    COMPOSITION.has(name) ||
    (previous.getPropertyValue(name) === current.getPropertyValue(name) &&
      previous.getPropertyPriority(name) === current.getPropertyPriority(name));
  for (let index = 0; index < previous.length; index++)
    if (!unchanged(previous.item(index))) return false;
  for (let index = 0; index < current.length; index++)
    if (!unchanged(current.item(index))) return false;
  return true;
}

export function ignores_composition(record, scene) {
  if (record.type === "childList") {
    if (scene.is_surface(record.target)) return true;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.length > 0 && nodes.every(scene.is_surface);
  }
  if (record.type !== "attributes") return false;
  if (scene.is_surface(record.target))
    return SURFACE_ATTRIBUTES.has(record.attributeName);
  const layer = scene.owner(record.target);
  return (
    layer?.element === record.target &&
    record.attributeName === "style" &&
    composition_style(record)
  );
}
