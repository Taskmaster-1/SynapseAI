export const GITHUB_REPO = "Taskmaster-1/SynapseAI";
export const GITHUB = `https://github.com/${GITHUB_REPO}`;

/**
 * The repository's star count, fetched on the server at build time and refreshed hourly
 * (ISR). Null when there are none yet, or when GitHub can't be reached or rate-limits us: the page then shows no
 * count rather than a made-up one. Visitors' browsers never call GitHub.
 */
export async function githubStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "synapse-website" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const { stargazers_count } = (await res.json()) as { stargazers_count?: unknown };
    // Zero isn't worth showing; the button reads fine without a count.
    return typeof stargazers_count === "number" && stargazers_count > 0 ? stargazers_count : null;
  } catch {
    return null;
  }
}

export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}
