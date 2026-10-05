const WOTAKU = "https://wotaku.wiki/ext/mangayomi";

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300"
    }
  });
}

function absolute(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}

async function getText(url) {
  const r = await fetch(url, { headers: { "user-agent": "AnymeX-Wotaku-Hub/1.0" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}

function githubReposFromWotaku(html) {
  const out = new Map();
  const re = /href=["'](https?:\/\/github\.com\/[^"'?#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1].replace(/\/+$/, "");
    const parts = new URL(u).pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] !== "topics" && parts[0] !== "settings") {
      out.set(`${parts[0]}/${parts[1]}`, u);
    }
  }
  return [...out.entries()];
}

function indexUrlsFromReadme(text, repo) {
  const urls = new Set();
  const re = /https?:\/\/[^\s<>"'`\\)]+(?:index\.json)/gi;
  let m;
  while ((m = re.exec(text))) urls.add(m[0].replace(/[),.;]+$/, ""));
  for (const kind of ["manga", "anime", "novel"]) {
    if (repo === "m2k3a/mangayomi-extensions") {
      urls.add(`https://m2k3a.github.io/mangayomi-extensions/${kind === "manga" ? "index" : kind + "_index"}.json`);
    }
    if (repo === "9vsv6/mangayomi-ar-extensions") {
      urls.add(`https://raw.githubusercontent.com/9vsv6/mangayomi-ar-extensions/refs/heads/main/${kind}_index.json`);
    }
    if (repo === "gato404/kegareta-sauces") {
      urls.add(`https://raw.githubusercontent.com/gato404/kegareta-sauces/main/${kind === "manga" ? "index" : kind + "_index"}.json`);
    }
  }
  return [...urls];
}

async function build() {
  const page = await getText(WOTAKU);
  const repos = githubReposFromWotaku(page);
  const result = [];

  for (const [repo, github] of repos) {
    let readme = "";
    try { readme = await getText(`${github}/raw/refs/heads/main/README.md`); } catch {}
    const urls = indexUrlsFromReadme(readme, repo);

    // Also inspect GitHub repo HTML for visible index.json files.
    if (!urls.length) {
      try {
        const gh = await getText(github);
        const names = [...gh.matchAll(/href=["'][^"']*\/blob\/(?:main|master)\/([^"']*index\.json)["']/gi)]
          .map(x => decodeURIComponent(x[1]));
        for (const n of names) {
          urls.push(`https://raw.githubusercontent.com/${repo}/refs/heads/main/${n}`);
        }
      } catch {}
    }

    if (urls.length) {
      result.push({
        name: repo.split("/")[0],
        repo,
        github,
        indexes: [...new Set(urls)].map(url => ({
          type: /anime/i.test(url) ? "Anime" : /novel/i.test(url) ? "Novel" : "Manga",
          url
        }))
      });
    }
  }

  return result;
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/api/repos") {
      try {
        return cors(JSON.stringify({ source: WOTAKU, repos: await build() }));
      } catch (e) {
        return cors(JSON.stringify({ error: String(e) }), 502);
      }
    }
    return new Response("AnymeX Wotaku API is running.", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
