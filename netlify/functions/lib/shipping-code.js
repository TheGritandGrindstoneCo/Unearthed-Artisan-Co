// Free-shipping codes for family. Only a SHA-256 fingerprint of each code is
// kept here, so the code itself never appears in the site's files — someone
// reading this repo or the public JavaScript can't find it.
//
// To add or change a code, put its fingerprint in the list. In PowerShell:
//   $b = [Text.Encoding]::UTF8.GetBytes("NEWCODE")
//   -join ([Security.Cryptography.SHA256]::Create().ComputeHash($b) | % { $_.ToString("x2") })
// (codes are matched in capitals, so hash the code in capitals).
const crypto = require("crypto");

const FREE_SHIPPING_CODE_HASHES = [
  "90880753df66d762c27536072cd8f118b203fb22bf390f3179e743eb2c563f18", // family code (10/13/2026)
];

function normalizeShippingCode(code) {
  return String(code || "").trim().toUpperCase();
}

// True when the code makes Local Delivery and Standard Shipping free.
function isFreeShippingCode(code) {
  const normalized = normalizeShippingCode(code);
  if (!normalized || normalized.length > 40) return false;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  return FREE_SHIPPING_CODE_HASHES.includes(hash);
}

module.exports = { normalizeShippingCode, isFreeShippingCode };
