// The attributes that the GPU text runtime sets on a target. The stylesheet
// ./gpu.css uses the same names.

// "ready" while the GPU copy shows the ink of a text target.
export const TEXT_READY_ATTRIBUTE = "data-folly-gpu-text";
// "ready" while the GPU copy shows the decoration of a panel target.
export const PANEL_READY_ATTRIBUTE = "data-folly-gpu-panel";
// Present while a capture reads the native ink of a target.
export const CAPTURE_ATTRIBUTE = "data-folly-capture";
