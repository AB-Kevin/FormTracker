"use strict";

const crypto = require("crypto");

// Short, URL-friendly, case-insensitive-safe token embedded in each
// recipient's Gravity Forms link (as ?rtoken=...) and in their filled PDF, so
// a returned response -- by any channel -- can be matched back to exactly
// one mailing_recipient. Base32 (Crockford-ish alphabet, no 0/O/1/I) avoids
// characters that are easy to misread if someone ever has to type it in by
// hand off a printed page.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateToken(length = 10) {
  const bytes = crypto.randomBytes(length);
  let token = "";
  for (let i = 0; i < length; i++) {
    token += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return token;
}

module.exports = { generateToken };
