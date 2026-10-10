// verbatim.js — the one gate for the rule "verbatim or nothing" (copied from Reader): a quote counts only if it is a
// word-for-word span of its source. Curly and straight quotes and runs of whitespace count as the same; nothing else
// is forgiven.
export const normalize = (t) => String(t ?? "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
// Is `span` (non-empty) word for word inside `source`?
export const verbatimIn = (source, span) => { const s = normalize(span); return !!s && normalize(source).includes(s); };
