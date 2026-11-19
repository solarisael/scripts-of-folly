export function create_layer(element, surface, scene, release) {
  const resources = new Set();
  let disposed = false;
  const require_live = () => {
    if (disposed) throw new Error("The scene layer is disposed.");
  };
  const layer = {
    element,
    surface,
    get disposed() {
      return disposed;
    },
    get parent() {
      return scene.owner(element.parentNode);
    },
    own(dispose) {
      require_live();
      resources.add(dispose);
      return layer;
    },
    disown(dispose) {
      resources.delete(dispose);
    },
    set_order(order) {
      require_live();
      element.style.zIndex = String(order);
    },
    set_transform(transform) {
      require_live();
      element.style.transform = transform;
    },
    set_opacity(opacity) {
      require_live();
      element.style.opacity = String(opacity);
    },
    add(child, options) {
      require_live();
      if (child === element || child.contains(element))
        throw new Error("A scene layer cannot contain itself.");
      const child_layer = scene.layer(child, options);
      element.append(child);
      return child_layer;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const failures = [];
      const dispose = (callback) => {
        try {
          callback();
        } catch (error) {
          failures.push(error);
        }
      };
      for (const child of element.querySelectorAll("*")) {
        const owned = scene.owner(child);
        if (owned?.element === child) dispose(() => owned.dispose());
      }
      for (const callback of resources) dispose(callback);
      resources.clear();
      release();
      if (failures.length)
        throw new AggregateError(failures, "Scene layer disposal failed.");
    },
  };
  return layer;
}
