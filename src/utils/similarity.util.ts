/** Normaliza un texto: minúsculas, sin tildes, sin signos y con espacios colapsados. */
export function normalizeText(value: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = current;
  }

  return prev[b.length];
}

/** Distancia de Levenshtein normalizada a un score 0-1. */
export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** Proporción de tokens compartidos (índice de Jaccard ponderado por prefijos). */
export function tokenOverlap(a: string, b: string): number {
  const left = a.split(" ").filter(Boolean);
  const right = b.split(" ").filter(Boolean);
  if (!left.length || !right.length) return 0;

  const matched = left.filter((token) =>
    right.some(
      (other) => other === token || other.startsWith(token) || token.startsWith(other)
    )
  ).length;

  return matched / Math.max(left.length, right.length);
}

/**
 * Similitud combinada entre dos nombres: 55% Levenshtein normalizado,
 * 45% coincidencia de tokens. Devuelve un valor entre 0 y 1.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const containment = left.includes(right) || right.includes(left) ? 0.9 : 0;
  const score = levenshteinRatio(left, right) * 0.55 + tokenOverlap(left, right) * 0.45;

  return Math.min(1, Math.max(score, containment));
}
