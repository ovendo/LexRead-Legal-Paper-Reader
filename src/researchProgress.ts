import type { AppState, ResearchDocument } from "./types";

const processingWeight: Record<ResearchDocument["status"], number> = {
  uploaded: 8,
  parsing: 20,
  ocr: 35,
  review: 48,
  analyzing: 62,
  ready: 72,
  failed: 5,
};

export function getProjectProgress(state: AppState, projectId: string) {
  const documents = state.documents.filter((document) => document.projectId === projectId && !document.archivedAt);
  if (!documents.length) return 0;

  const processing = documents.reduce((sum, document) => sum + processingWeight[document.status], 0) / documents.length;
  const reading = documents.reduce((sum, document) => sum + (document.pages ? document.currentPage / document.pages : 0), 0) / documents.length * 12;

  const evidenceItems = documents.flatMap((document) => [
    ...(document.nodes ?? []).map((node) => ({ anchored: Boolean(node.sourceAnchors?.length), verified: node.status === "understood" })),
    ...(document.issues ?? []).map((issue) => ({ anchored: Boolean(issue.sourceAnchors?.length), verified: issue.status === "已完成" })),
  ]);
  const evidence = evidenceItems.length
    ? evidenceItems.filter((item) => item.anchored && item.verified).length / evidenceItems.length * 12
    : 0;

  const activeDocumentIds = new Set(documents.map((document) => document.id));
  const cards = state.cards.filter((card) => card.projectId === projectId && activeDocumentIds.has(card.documentId));
  const cardQuality = cards.length
    ? cards.filter((card) => card.sourceAnchor && card.verifyStatus === "已核验").length / cards.length * 4
    : 0;

  return Math.min(100, Math.round(processing + reading + evidence + cardQuality));
}
