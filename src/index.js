const WOTAKU_URL = "https://wotaku.wiki/ext/mangayomi";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "cache-control": "public, max-age=300"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8"
    }
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "AnymeX-Wotaku-Hub/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function discoverGithubRepos(html) {
  const repos = new Map();

  const pattern =
    /href\s*=\s*["'](https?:\/\/github\.com\/[^"'?#\s]+)["']/gi;

  for (const match of html.matchAll(pattern)) {
    const url = decodeHtml(match[1]).replace(/\/+$/, "");

    const parts = new URL(url).pathname
      .split("/")
      .filter(Boolean);

    if (parts.length !== 2) continue;

    const [owner, repo] = parts;

    if (
      ["topics", "search", "settings", "marketplace"]
        .includes(owner.toLowerCase())
    ) {
      continue;
    }

    repos.set(`${owner}/${repo}`, {
      name: owner,
      repo: `${owner}/${repo}`,
      github: `https://github.com/${owner}/${repo}`
    });
  }

  return [...repos.values()];
}

function indexType(url) {
  const lower = url.toLowerCase();

  if (lower.includes("anime_index.json")) {
    return "Anime";
  }

  if (lower.includes("novel_index.json")) {
    return "Novel";
  }

  return "Manga";
}

function extractIndexUrls(text) {
  const urls = new Set();

  const pattern =
    /https?:\/\/[^\s<>"'`\\)]+(?:index\.json)/gi;

  for (const match of text.matchAll(pattern)) {
    urls.add(
      match[0].replace(/[),.;]+$/, "")
    );
  }

  return [...urls];
}

async function githubApi(repo) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents`,
    {
      headers: {
        "accept": "application/vnd.github+json",
        "user-agent": "AnymeX-Wotaku-Hub/1.0"
      }
    }
  );

  if (!response.ok) {
    return [];
  }

  return response.json();
}

async function discoverRepoIndexes(repo) {
  const urls = new Set();

  // Try README on main, then master.
  for (const branch of ["main", "master"]) {
    try {
      const readme = await fetchText(
        `https://raw.githubusercontent.com/${repo}/refs/heads/${branch}/README.md`
      );

      for (const url of extractIndexUrls(readme)) {
        urls.add(url);
      }

      if (urls.size > 0) {
        break;
      }
    } catch {}
  }

  // Also inspect the GitHub repository itself.
  try {
    const entries = await githubApi(repo);

    for (const entry of entries) {
      if (
        entry.type === "file" &&
        /(?:^|\/)(?:anime_|novel_)?index\.json$/i.test(
          entry.name
        )
      ) {
        urls.add(
          `https://raw.githubusercontent.com/${repo}/refs/heads/main/${entry.path}`
        );
      }
    }
  } catch {}

  return [...urls];
}

async function buildRepositoryList() {
  const wotakuHtml =
    await fetchText(WOTAKU_URL);

  const repos =
    discoverGithubRepos(wotakuHtml);

  const results = await Promise.all(
    repos.map(async (repo) => {
      const indexes =
        await discoverRepoIndexes(repo.repo);

      return {
        ...repo,
        indexes: indexes.map((url) => ({
          type: indexType(url),
          url
        }))
      };
    })
  );

  return results
    .filter(
      (repo) => repo.indexes.length > 0
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name)
    );
}

export default {
  async fetch(request) {
    const url =
      new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // Basic health check
    if (
      url.pathname === "/" ||
      url.pathname === "/api"
    ) {
      return new Response(
        "AnymeX Wotaku API is running. Use /api/repos",
        {
          headers: {
            ...CORS_HEADERS,
            "content-type":
              "text/plain; charset=utf-8"
          }
        }
      );
    }

    // Main API endpoint
    if (url.pathname === "/api/repos") {
      try {
        const repos =
          await buildRepositoryList();

        return json({
          source: WOTAKU_URL,
          updated_at:
            new Date().toISOString(),
          count: repos.length,
          repos
        });
      } catch (error) {
        return json(
          {
            error:
              "Unable to retrieve the current Wotaku repository list.",
            detail:
              error instanceof Error
                ? error.message
                : String(error)
          },
          502
        );
      }
    }

    return json(
      { error: "Not found" },
      404
    );
  }
};
