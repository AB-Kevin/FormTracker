"use strict";

// Columns FormTracker never keeps. The membership software's exports carry
// identity, health and insurance-claim details alongside the names and
// addresses a mailing needs, and anything FormTracker keeps sits in a data
// folder everyone it's shared with can read. Imports leave these out, and
// contacts saved before this was added have them removed (main.js).
//
// Matched ignoring case, spaces and punctuation, so "Last 4 SSN" is caught as
// well as "Last4SSN".

const SENSITIVE = [
  "last4ssn",
  "ssnlast4",
  "ssn",
  "socialsecuritynumber",
  "socialsecurityexempt",
  "has4029copyonfile",
  "haspreexistingcondition",
  "preexisting",
  "accidentdeductibleyear",
  "accidentdate",
  "accidentdescription",
  "accidentcategory",
  "accidenttype",
  "caseidifany",
  "defectcodeifany",
  "isadultwithdisability",
  "coveredbymedicarepart",
];

const normalize = (header) => String(header).toLowerCase().replace(/[^a-z0-9]/g, "");

function isSensitive(header) {
  return SENSITIVE.includes(normalize(header));
}

/** `extra` without its sensitive columns, or the same object when it has none. */
function withoutSensitive(extra) {
  if (!extra || !Object.keys(extra).some(isSensitive)) return extra;
  return Object.fromEntries(Object.entries(extra).filter(([key]) => !isSensitive(key)));
}

module.exports = { isSensitive, withoutSensitive };
