function isAllowedEmail(email, allowlist) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return allowlist.some((allowed) => String(allowed).trim().toLowerCase() === normalized);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAllowedEmail };
}
