// Unpaywall: open-access PDF lookup by DOI. Not a search; the API requires a contact email.

// Returns the best open-access PDF URL for a DOI, or null when there is none (or the DOI is unknown).
export async function oaPdf(doi, { email, fetch } = {}) {
  if (!email) throw new Error('Unpaywall requires an email');
  const path = String(doi).trim().split('/').map(encodeURIComponent).join('/');
  const url = `https://api.unpaywall.org/v2/${path}?email=${encodeURIComponent(email)}`;
  const res = await (fetch ?? globalThis.fetch)(url, { headers: { 'user-agent': `researchgod/0.1 (mailto:${email})` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Unpaywall HTTP ${res.status}`);
  const j = await res.json();
  return j.best_oa_location?.url_for_pdf ?? null;
}
