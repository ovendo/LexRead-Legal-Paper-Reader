export function readingFootnoteMarker(block) {
  const explicit = String(block?.footnoteMarker ?? "").trim();
  if (explicit) return explicit;
  return String(block?.text ?? "").trim().match(/^(\*+|[①②③④⑤⑥⑦⑧⑨⑩]|\d{1,3})/)?.[1] ?? null;
}

export function linkFootnoteReferences(blocks, footnotes) {
  const linkedFootnotes = footnotes.map((footnote) => ({
    ...footnote,
    footnoteMarker: readingFootnoteMarker(footnote),
  }));
  const linkedBlocks = blocks.map((block) => ({
    ...block,
    footnoteRefs: (block.footnoteRefs ?? []).map((reference) => {
      const target = linkedFootnotes
        .filter((footnote) => footnote.footnoteMarker === reference.marker)
        .sort((left, right) => Math.abs(left.page - block.page) - Math.abs(right.page - block.page))[0];
      return { ...reference, targetFootnoteId: target?.id ?? null };
    }),
  }));
  const footnotesWithReferences = linkedFootnotes.map((footnote) => ({
    ...footnote,
    footnoteReferences: linkedBlocks.flatMap((block) => (block.footnoteRefs ?? [])
      .filter((reference) => reference.targetFootnoteId === footnote.id)
      .map((reference) => ({
        blockId: block.id,
        page: block.page,
        marker: reference.marker,
        quote: reference.quote,
        startOffset: reference.startOffset,
        endOffset: reference.endOffset,
      }))),
  }));
  return { blocks: linkedBlocks, footnotes: footnotesWithReferences };
}
