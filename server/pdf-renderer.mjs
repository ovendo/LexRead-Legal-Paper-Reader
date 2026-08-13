import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

function estimateInkCoverage(context, width, height) {
  const step = Math.max(4, Math.round(Math.max(width, height) / 260));
  const pixels = context.getImageData(0, 0, width, height).data;
  let sampled = 0;
  let ink = 0;
  for (let y = Math.floor(step / 2); y < height; y += step) {
    for (let x = Math.floor(step / 2); x < width; x += step) {
      const index = (y * width + x) * 4;
      sampled += 1;
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) ink += 1;
    }
  }
  return sampled ? ink / sampled : 0;
}

export async function createPdfRenderer(filePath) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await readFile(filePath));
  const loadingTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;

  return {
    pageCount: pdf.numPages,
    async render(pageNumber, options = {}) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error(`PDF 不存在第 ${pageNumber} 页。`);

      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxDimension = Math.max(1200, Math.min(2600, Number(options.maxDimension ?? 2100)));
      const requestedScale = Math.max(1, Math.min(3, Number(options.scale ?? 2.2)));
      const scale = Math.min(requestedScale, maxDimension / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport, intent: "display" }).promise;
      const inkCoverage = estimateInkCoverage(context, canvas.width, canvas.height);
      const bytesOut = canvas.toBuffer("image/jpeg", Number(options.quality ?? 88));

      return {
        bytes: bytesOut,
        dataUrl: `data:image/jpeg;base64,${bytesOut.toString("base64")}`,
        width: canvas.width,
        height: canvas.height,
        pageNumber,
        inkCoverage,
        isVisuallyBlank: inkCoverage < 0.00015,
      };
    },
    async close() {
      await pdf.destroy();
    },
  };
}

export async function renderPdfPage(filePath, pageNumber, options = {}) {
  const renderer = await createPdfRenderer(filePath);
  try {
    return await renderer.render(pageNumber, options);
  } finally {
    await renderer.close();
  }
}
