export function create_layer_stack(layers, document_value) {
  let ordered = Object.freeze([...layers]);
  if (new Set(ordered).size !== ordered.length)
    throw new Error("A layer stack cannot contain duplicates.");
  const apply = (next) => {
    for (const layer of next) {
      if (layer.disposed || layer.element.ownerDocument !== document_value)
        throw new Error("A layer stack needs live layers from one document.");
    }
    next.forEach((layer, index) => layer.set_order(next.length - index));
    ordered = Object.freeze(next);
  };
  apply([...ordered]);
  return {
    get layers() {
      return ordered;
    },
    move(layer, offset) {
      const index = ordered.indexOf(layer);
      if (index < 0) throw new Error("The layer is not in this stack.");
      if (!Number.isInteger(offset))
        throw new RangeError("A stack move needs an integer offset.");
      const next_index = index + offset;
      if (next_index < 0 || next_index >= ordered.length || offset === 0)
        return false;
      const next = [...ordered];
      next.splice(index, 1);
      next.splice(next_index, 0, layer);
      apply(next);
      return true;
    },
  };
}
