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
    throw new Error(`${response.status} ${response.statusText}`);
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
  const pattern = /href\s*=\s*["'](https?:\/\/github\.com\/[^"'?#\s]+)["']/gi;

  for (const match of html.matchAll(pattern)) {
    const url = decodeHtml(match[1]).replace(/\/+$/, "");
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length !== 2) continue;

    const [owner, repo] = parts;

    if (["topics", "search", "settings", "marketplace"].includes(owner.toLowerCase())) {
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

function buildRepoIndexes(repo) {
  return [
    {
      type: "Manga",
      url: `https://raw.githubusercontent.com/${repo}/main/index.json`
    },
    {
      type: "Anime",
      url: `https://raw.githubusercontent.com/${repo}/main/anime_index.json`
    },
    {
      type: "Novel",
      url: `https://raw.githubusercontent.com/${repo}/main/novel_index.json`
    }
  ];
}

async function buildRepositoryList() {
  const wotakuHtml = await fetchText(WOTAKU_URL);
  const repos = discoverGithubRepos(wotakuHtml);

  return repos
    .map((repo) => ({
      ...repo,
      indexes: buildRepoIndexes(repo.repo)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // Health check root
    if (url.pathname === "/" || url.pathname === "/api") {
      return new Response("AnymeX Wotaku API is active. Access /api/repos for data.", {
        headers: {
          ...CORS_HEADERS,
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }

    // Main API endpoint
    if (url.pathname === "/api/repos") {
      try {
        const repos = await buildRepositoryList();

        return json({
          source: WOTAKU_URL,
          updated_at: new Date().toISOString(),
          count: repos.length,
          repos
        });
      } catch (error) {
        return json(
          {
            error: "Unable to retrieve the current Wotaku repository list.",
            detail: error instanceof Error ? error.message : String(error)
          },
          502
        );
      }
    }

    return json({ error: "Not found" }, 404);
  }
};
;
