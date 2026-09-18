"use strict";

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const WRAP_CHARS = 90;

function wrapParagraph(text, wrapChars) {
  const lines = [];
  for (const raw of String(text).split("\n")) {
    if (raw.trim() === "") {
      lines.push("");
      continue;
    }
    let remaining = raw;
    while (remaining.length > wrapChars) {
      let breakAt = remaining.lastIndexOf(" ", wrapChars);
      if (breakAt <= 0) breakAt = wrapChars;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    lines.push(remaining);
  }
  return lines;
}

// Generates a simple print-ready letter for a no-email contact: an address
// block (for a windowed envelope) followed by the merged template body, with
// the response token printed at the bottom so a form mailed back can be
// matched to this recipient by hand.
async function generatePaperLetter(bodyText, contact, token) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const drawLine = (text, { size = 11, gapAfter = 4, color = rgb(0, 0, 0) } = {}) => {
    if (y < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    page.drawText(text, { x: MARGIN, y, size, font, color });
    y -= size + gapAfter;
  };

  drawLine(new Date().toLocaleDateString(), { gapAfter: 20 });
  drawLine(contact.name || "", { gapAfter: 2 });
  if (contact.addressLine1) drawLine(contact.addressLine1, { gapAfter: 2 });
  if (contact.addressLine2) drawLine(contact.addressLine2, { gapAfter: 2 });
  const cityStateZip = [contact.city, [contact.state, contact.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  if (cityStateZip) drawLine(cityStateZip, { gapAfter: 2 });
  y -= 20;

  for (const line of wrapParagraph(bodyText, WRAP_CHARS)) {
    drawLine(line || " ");
  }

  y -= 16;
  drawLine(`Reference: ${token}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });

  return pdfDoc.save();
}

module.exports = { generatePaperLetter };
