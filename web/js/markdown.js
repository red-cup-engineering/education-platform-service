import { readMarkdownSource } from '@red-cup-engineering/markdown-engineering-services-section/read-markdown-structure';

/** Hide the adapter-declared exercise metadata, retaining ordinary fenced code. */
export function stripExerciseFences(body, labels) {
  if (!Array.isArray(labels) || labels.length === 0) return body.trim();
  const source = readMarkdownSource(body, { frontmatter: false });
  const exerciseLabels = new Set(labels);
  let output = '', cursor = 0;
  for (const range of source.codeRanges) {
    if (range.type !== 'fenced-code' || !exerciseLabels.has(range.info.trim().split(/\s+/u)[0])) continue;
    output += source.text.slice(cursor, range.start);
    cursor = range.end;
  }
  return (output + source.text.slice(cursor)).trim();
}
