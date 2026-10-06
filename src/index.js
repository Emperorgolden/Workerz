const SOURCES = [
  {
    id: "mihon",
    name: "Mihon / Aniyomi",
    url: "https://wotaku.wiki/ext/mihon"
  },
  {
    id: "mangayomi",
    name: "Mangayomi",
    url: "https://wotaku.wiki/ext/mangayomi"
  },
  {
    id: "ios",
    name: "iOS",
    url: "https://wotaku.wiki/ext/ios"
  },
  {
    id: "misc",
    name: "Miscellaneous",
    url: "https://wotaku.wiki/ext/misc"
  }
];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Content-Type, Accept",
  "access-control-max-age": "86400"
};

function response(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      ...CORS,
      ...extra
    }
  });
}

function json(data, status = 200, cache = "public, max-age=300, stale-while-revalidate=900") {
  return response(
    JSON.stringify(data),
    status,
    {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
    }
  );
}

async function fetchText(url) {
  const result = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": "Wotaku-AnymeX-Hub/2.0",
      "accept": "text/html,application/xhtml+xml"
    }
  });

  if (!result.ok) {
    throw new Error(`${result.status} ${result.statusText}`);
  }

  return result.text();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");
}

function cleanText(value) {
  return decodeHtml(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function extractTarget(href, base) {
  try {
    const url = new URL(href, base);

    for (const key of [
      "url",
      "repo",
      "repo_url",
      "repository",
      "novel_url",
      "manga_url",
      "anime_url"
    ]) {
      const value = url.searchParams.get(key);

      if (value) {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      }
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }

    return null;
  } catch {
    return null;
  }
}

function getScheme(value) {
  try {
    return new URL(value).protocol.replace(":", "").toLowerCase();
  } catch {
    return "";
  }
}

function inferCategory(name, section, sourceId) {
  const value = `${name} ${section}`.toLowerCase();

  if (
    /\b(movie|movies|film|films|cine|cinema|netmirror|megix|multimovies)\b/.test(
      value
    )
  ) {
    return "Movies";
  }

  if (
    /\b(tv|show|shows|series|drama|episode|television)\b/.test(
      value
    )
  ) {
    return "TV";
  }

  if (
    /\b(manga|manhwa|manhua|comic|comics|reader|paperback|aidoku|suwatte|kotatsu)\b/.test(
      value
    )
  ) {
    return "Manga";
  }

  if (
    /\b(novel|novels|lnreader|light novel|sourcery|shosetsu)\b/.test(
      value
    )
  ) {
    return "Novels";
  }

  if (
    /\b(anime|ani|anim|sora|mangayomi|cloudstream|hayase)\b/.test(
      value
    )
  ) {
    return "Anime";
  }

  if (sourceId === "ios") {
    return "iOS";
  }

  return "Misc";
}

function shouldKeepExternal(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    if (host === "wotaku.wiki" || host.endsWith(".wotaku.wiki")) {
      return false;
    }

    if (
      host.includes("youtube.com") ||
      host.includes("youtu.be") ||
      host.includes("google.com") ||
      host.includes("googleusercontent.com")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function looksLikeRepository(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return (
      host === "github.com" ||
      host.endsWith(".github.io") ||
      host === "gitlab.com" ||
      host.endsWith(".gitlab.io") ||
      host === "codeberg.org" ||
      host.endsWith(".codeberg.page") ||
      host.endsWith(".pages.dev")
    );
  } catch {
    return false;
  }
}

function parseWotakuPage(html, source) {
  const mainStart = html.search(/<main\b/i);

  let content = mainStart >= 0
    ? html.slice(mainStart)
    : html;

  const footerStart = content.search(/<footer\b/i);

  if (footerStart >= 0) {
    content = content.slice(0, footerStart);
  }

  const headings = [];

  const headingPattern =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;

  let headingMatch;

  while ((headingMatch = headingPattern.exec(content))) {
    headings.push({
      index: headingMatch.index,
      level: Number(headingMatch[1]),
      text: cleanText(headingMatch[2])
    });
  }

  const anchors = [];

  const anchorPattern =
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;

  let anchorMatch;

  while ((anchorMatch = anchorPattern.exec(content))) {
    anchors.push({
      index: anchorMatch.index,
      href: decodeHtml(anchorMatch[2]),
      text: cleanText(anchorMatch[3])
    });
  }

  const entries = new Map();

  let lastNamedLink = null;

  for (const anchor of anchors) {
    const href = anchor.href.trim();

    if (!href || href.startsWith("#")) {
      continue;
    }

    const resolved = absoluteUrl(href, source.url);

    if (!resolved) {
      continue;
    }

    const isInstall =
      /\binstall\b/i.test(anchor.text);

    const externalHttp =
      /^https?:\/\//i.test(resolved);

    const customScheme =
      !externalHttp &&
      /:\/\//.test(resolved);

    const repositoryLink =
      externalHttp &&
      looksLikeRepository(resolved);

    if (!isInstall && !repositoryLink && !customScheme) {
      continue;
    }

    if (externalHttp && !shouldKeepExternal(resolved)) {
      continue;
    }

    let section = source.name;

    for (const heading of headings) {
      if (heading.index > anchor.index) {
        break;
      }

      section = heading.text || section;
    }

    if (
      anchor.text &&
      !/^install$/i.test(anchor.text) &&
      !/^add$/i.test(anchor.text) &&
      !/^open$/i.test(anchor.text)
    ) {
      lastNamedLink = {
        name: anchor.text,
        url: resolved
      };
    }

    const target =
      extractTarget(resolved, source.url);

    const key =
      target ||
      resolved;

    let entry =
      entries.get(key);

    if (!entry) {
      entry = {
        id: `${source.id}:${entries.size}`,
        sourceId: source.id,
        sourceName: source.name,
        pageUrl: source.url,
        name:
          isInstall
            ? (
                lastNamedLink?.name ||
                section ||
                "Repository"
              )
            : (
                anchor.text ||
                section ||
                "Repository"
              ),
        section,
        category: inferCategory(
          isInstall
            ? (
                lastNamedLink?.name ||
                section
              )
            : (
                anchor.text ||
                section
              ),
          section,
          source.id
        ),
        url: target || resolved,
        installUrl: null,
        scheme: "",
        kind: isInstall
          ? "install"
          : "repository"
      };

      entries.set(key, entry);
    }

    if (isInstall) {
      entry.installUrl = resolved;
      entry.scheme = getScheme(resolved);

      if (lastNamedLink?.name) {
        entry.name = lastNamedLink.name;
      }

      entry.category = inferCategory(
        entry.name,
        section,
        source.id
      );
    } else if (
      entry.name === "Repository" ||
      entry.name === section
    ) {
      entry.name =
        anchor.text ||
        entry.name;
    }
  }

  return [...entries.values()];
}

async function loadSource(source) {
  const html = await fetchText(source.url);
  const entries = parseWotakuPage(html, source);

  return {
    source: {
      id: source.id,
      name: source.name,
      url: source.url
    },
    updated_at: new Date().toISOString(),
    count: entries.length,
    entries
  };
}

function validPublicHttpUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    if (url.username || url.password) {
      return null;
    }

    const host = url.hostname.toLowerCase();

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

async function pingUrl(target) {
  const url = validPublicHttpUrl(target);

  if (!url) {
    return {
      ok: false,
      status: 400,
      statusText: "Invalid public URL"
    };
  }

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    8000
  );

  try {
    const result = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": "Wotaku-AnymeX-Hub/2.0",
        "accept": "*/*",
        "range": "bytes=0-2047"
      },
      signal: controller.signal
    });

    if (result.body) {
      try {
        await result.body.cancel();
      } catch {}
    }

    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText || "",
      finalUrl: result.url || url
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText:
        error?.name === "AbortError"
          ? "Timeout"
          : String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "OPTIONS"
    ) {
      return response(null, 204);
    }

    if (
      request.method !== "GET" &&
      request.method !== "HEAD"
    ) {
      return json(
        {
          error: "Method not allowed"
        },
        405
      );
    }

    if (
      url.pathname === "/" ||
      url.pathname === "/api"
    ) {
      return response(
        "AnymeX Wotaku API is running.",
        200,
        {
          "content-type":
            "text/plain; charset=utf-8",
          "cache-control":
            "public, max-age=300"
        }
      );
    }

    if (
      url.pathname === "/api/source"
    ) {
      const sourceId =
        url.searchParams.get("source");

      const source =
        SOURCES.find(
          item => item.id === sourceId
        );

      if (!source) {
        return json(
          {
            error: "Unknown Wotaku source"
          },
          404
        );
      }

      try {
        return json(
          await loadSource(source)
        );
      } catch (error) {
        return json(
          {
            error:
              "Unable to read the Wotaku source.",
            detail:
              error instanceof Error
                ? error.message
                : String(error)
          },
          502,
          "no-store"
        );
      }
    }

    if (
      url.pathname === "/api/repos"
    ) {
      try {
        const results =
          await Promise.all(
            SOURCES.map(
              source => loadSource(source)
            )
          );

        const entries =
          results.flatMap(
            result => result.entries
          );

        return json({
          sources: results.map(
            result => result.source
          ),
          updated_at:
            new Date().toISOString(),
          count: entries.length,
          entries
        });
      } catch (error) {
        return json(
          {
            error:
              "Unable to build the Wotaku catalog.",
            detail:
              error instanceof Error
                ? error.message
                : String(error)
          },
          502,
          "no-store"
        );
      }
    }

    if (
      url.pathname === "/api/ping"
    ) {
      const target =
        url.searchParams.get("url");

      const result =
        await pingUrl(target);

      return json(
        result,
        result.status === 0
          ? 502
          : 200,
        "no-store"
      );
    }

    if (
      url.pathname === "/api/index"
    ) {
      const target =
        url.searchParams.get("url");

      const safeUrl =
        validPublicHttpUrl(target);

      if (!safeUrl) {
        return json(
          {
            error:
              "Invalid public index URL"
          },
          400,
          "no-store"
        );
      }

      try {
        const upstream =
          await fetch(safeUrl, {
            method: "GET",
            headers: {
              "user-agent":
                "Wotaku-AnymeX-Hub/2.0",
              "accept":
                "application/json,text/plain,*/*"
            }
          });

        const headers =
          new Headers(upstream.headers);

        headers.set(
          "access-control-allow-origin",
          "*"
        );

        headers.set(
          "cache-control",
          "public, max-age=300, stale-while-revalidate=900"
        );

        headers.set(
          "x-anymex-source",
          safeUrl
        );

        return new Response(
          upstream.body,
          {
            status: upstream.status,
            statusText:
              upstream.statusText,
            headers
          }
        );
      } catch (error) {
        return json(
          {
            error:
              "Unable to read extension index.",
            detail:
              error instanceof Error
                ? error.message
                : String(error)
          },
          502,
          "no-store"
        );
      }
    }

    return json(
      {
        error: "Not found"
      },
      404
    );
  }
};
