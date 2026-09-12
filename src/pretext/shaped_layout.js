import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  walkRichInlineLineRanges,
} from "@chenglou/pretext/rich-inline";

const MIN_SHAPED_LINE_WIDTH_RATIO = 0.34;

const chalice_width_ratio = (progress) => {
  if (progress < 0.16) return 0.9;
  if (progress < 0.56) return 0.9 - ((progress - 0.16) / 0.4) * 0.34;
  if (progress < 0.82) return 0.34;

  return 0.34 + ((progress - 0.82) / 0.18) * 0.42;
};

const shaped_width_ratio = ({ shape, lineIndex, lineCount }) => {
  if (lineCount <= 1) return 1;

  const progress = lineIndex / (lineCount - 1);

  if (shape === "diamond")
    return 0.38 + 0.62 * (1 - Math.abs(progress - 0.5) * 2);
  if (shape === "hourglass") return 0.42 + 0.58 * Math.abs(progress - 0.5) * 2;
  if (shape === "chalice") return chalice_width_ratio(progress);
  if (shape === "vessel") {
    const shoulder = Math.sin(progress * Math.PI);
    return 0.5 + 0.5 * shoulder * (1 - 0.24 * progress);
  }

  return 1;
};

const shaped_line_width = ({ shape, width, lineIndex, lineCount }) =>
  width *
  Math.max(
    MIN_SHAPED_LINE_WIDTH_RATIO,
    Math.min(1, shaped_width_ratio({ shape, width, lineIndex, lineCount })),
  );

const cursor_is_forward = (before, after) =>
  !before ||
  after.itemIndex > before.itemIndex ||
  (after.itemIndex === before.itemIndex &&
    (after.segmentIndex > before.segmentIndex ||
      (after.segmentIndex === before.segmentIndex &&
        after.graphemeIndex > before.graphemeIndex)));

const layout_once = ({ prepared, width, shape, lineCount }) => {
  const lines = [];
  let cursor;

  while (true) {
    const targetWidth = shaped_line_width({
      shape,
      width,
      lineIndex: lines.length,
      lineCount,
    });

    const range = layoutNextRichInlineLineRange(prepared, targetWidth, cursor);
    if (!range) break;
    if (!cursor_is_forward(cursor, range.end)) break;

    const line = materializeRichInlineLineRange(prepared, range);
    line.targetWidth = targetWidth;
    lines.push(line);
    cursor = range.end;
  }

  return lines;
};

export const layout_shaped_pretext_lines = ({ prepared, width, shape }) => {
  let line_count = Math.max(
    3,
    walkRichInlineLineRanges(prepared, width * 0.68, () => {}),
  );
  let lines = [];

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const next_lines = layout_once({
      prepared,
      width,
      shape,
      lineCount: Math.max(3, line_count),
    });

    const next_count = next_lines.length;
    lines = next_lines;
    if (next_count === line_count) break;
    line_count = next_count;
  }

  return lines;
};
