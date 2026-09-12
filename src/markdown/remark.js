import { transform_text_fx_markers_in_tree } from "./text_effects_markdown.js";

const remark_text_effects = () => {
  return (tree, file) => {
    const warning_cache = new Set();
    const warn =
      typeof file?.message === "function"
        ? (warning_message) => {
            file.message(warning_message);
          }
        : null;

    transform_text_fx_markers_in_tree(tree, {
      warn,
      warning_cache,
    });
  };
};

export { remark_text_effects };
