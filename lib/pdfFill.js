"use strict";

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

// Fills whichever of the fillable PDF's own form fields happen to match a
// contact field (by name, loosely) and always stamps the response token in
// the page footer -- regardless of whether the template has a field for it
// -- so a PDF returned by email or mail can always be matched back to a
// recipient by eye, even off a template FormTracker's never seen before.
// The form is left fillable (not flattened): prefilling known answers saves
// the recipient re-typing them, but they still need to fill in the rest.
async function fillPdf(templateBytes, contact, token) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const candidates = {
    id: contact.externalId,
    externalid: contact.externalId,
    memberid: contact.externalId,
    name: contact.name,
    email: contact.email,
    address: contact.addressLine1,
    addressline1: contact.addressLine1,
    addressline2: contact.addressLine2,
    city: contact.city,
    state: contact.state,
    zip: contact.zip,
    zipcode: contact.zip,
    ...Object.fromEntries(Object.entries(contact.extra || {}).map(([k, v]) => [k.toLowerCase(), v])),
  };

  for (const field of form.getFields()) {
    const rawName = field.getName();
    const key = rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
    let value = candidates[key];
    if (value === undefined) {
      const matchKey = Object.keys(candidates).find((k) => key.includes(k) || k.includes(key));
      if (matchKey) value = candidates[matchKey];
    }
    if (value === undefined || typeof field.setText !== "function") continue;
    try {
      field.setText(String(value));
    } catch {
      // Field type doesn't accept plain text (checkbox/radio/etc) -- leave it
      // for the recipient to fill in themselves.
    }
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const firstPage = pdfDoc.getPages()[0];
  if (firstPage) {
    const { width } = firstPage.getSize();
    firstPage.drawText(`Ref: ${token}`, {
      x: width - 110,
      y: 14,
      size: 8,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  return pdfDoc.save();
}

module.exports = { fillPdf };
