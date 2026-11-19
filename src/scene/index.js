import { create_layer } from "./layer.js";
import { ignores_composition } from "./mutations.js";
import { create_layer_stack } from "./stack.js";
export { create_render_queue } from "./render_queue.js";

const scenes = new WeakMap();

// The DOM is the scene graph. Resources belong to layers, not stacking numbers.
export function scene_for(document_value) {
  if (scenes.has(document_value)) return scenes.get(document_value);

  const layers = new WeakMap();
  const retired_surfaces = new WeakSet();
  const owner = (node) => {
    for (let current = node; current; current = current.parentNode) {
      const layer = layers.get(current);
      if (layer && !layer.disposed) return layer;
    }
    return null;
  };
  const is_surface = (node) =>
    owner(node)?.surface === true ||
    (!node.isConnected && retired_surfaces.has(node));
  const scene = {
    owner,
    is_surface,
    ignores_mutation: (record) => ignores_composition(record, scene),
    stack: (layers) => create_layer_stack(layers, document_value),
    compose(canvas, options) {
      return import("./compositor.js").then((module) =>
        module.create_compositor(canvas, options),
      );
    },
    layer(element, { surface = false } = {}) {
      if (element.ownerDocument !== document_value)
        throw new Error("A scene layer must use the scene document.");
      const existing = layers.get(element);
      if (existing && !existing.disposed) {
        if (existing.surface !== surface)
          throw new Error("A scene layer cannot change its content role.");
        return existing;
      }
      const layer = create_layer(element, surface, scene, () => {
        if (surface) retired_surfaces.add(element);
        layers.delete(element);
      });
      layers.set(element, layer);
      return layer;
    },
  };
  scenes.set(document_value, scene);
  return scene;
}
