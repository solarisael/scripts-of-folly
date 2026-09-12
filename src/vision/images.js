const image_source = (image) => {
  if (!image) return "";
  return image.currentSrc || image.src || "";
};

const create_loading_image = (dom_image) => {
  if (dom_image?.complete && dom_image.naturalWidth > 0) return dom_image;
  const image = new Image();
  image.decoding = "async";
  image.src = image_source(dom_image);
  return image;
};

const picture_sources = (picture) =>
  Array.from(picture?.querySelectorAll?.("source") ?? []);

export const create_banner_images = (banner) => {
  const fallback_image = banner.querySelector(".sol__vision_banner_image");
  const dom_image =
    fallback_image instanceof HTMLImageElement ? fallback_image : null;
  const image = create_loading_image(dom_image);

  const picture =
    dom_image?.closest?.("picture") ?? banner.querySelector("picture");
  const source_nodes = picture_sources(picture);

  const get_loaded_image = (event_target) => {
    if (dom_image?.complete && dom_image.naturalWidth > 0) return dom_image;
    if (
      (event_target === dom_image || event_target === image) &&
      event_target.naturalWidth > 0
    )
      return event_target;
    if (image.complete && image.naturalWidth > 0) return image;
    return null;
  };
  const get_image_source = (candidate) =>
    candidate === dom_image
      ? image_source(candidate)
      : image_source(candidate) || image_source(dom_image);
  return { image, dom_image, source_nodes, get_loaded_image, get_image_source };
};

export const listen_for_image = (
  target,
  event_name,
  callback,
  listener_cleanups,
) => {
  if (!target) return;
  if (typeof target.addEventListener === "function") {
    target.addEventListener(event_name, callback);
    listener_cleanups.push(() =>
      target.removeEventListener?.(event_name, callback),
    );
  } else {
    const property_name = `on${event_name}`;
    const previous_callback = target[property_name];
    target[property_name] = callback;
    listener_cleanups.push(() => {
      if (target[property_name] === callback)
        target[property_name] = previous_callback;
    });
  }
};

const image_matches_state = (state, image, source, width, height) =>
  state.image === image &&
  state.image_source === source &&
  state.image_width === width &&
  state.image_height === height;

export const update_banner_image = (state, loaded_image, next_source) => {
  const next_width = loaded_image.naturalWidth;
  const next_height = loaded_image.naturalHeight;
  if (
    image_matches_state(
      state,
      loaded_image,
      next_source,
      next_width,
      next_height,
    )
  )
    return false;

  state.image = loaded_image;
  state.image_source = next_source;
  state.image_width = next_width;
  state.image_height = next_height;
  state.effect?.set_image(loaded_image, next_width, next_height);
  state.runtime?.invalidate();
  return true;
};
