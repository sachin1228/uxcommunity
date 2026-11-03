const SERVICE_UNAVAILABLE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#000000">
<title>503 — This page isn't working · uxcommunity</title>
<style>
  :root {
    color-scheme: light dark;
    --background: #FAFAFA;
    --surface: #FFFFFF;
    --foreground: #0A0A0A;
    --muted: #525252;
    --border: #EAEAEA;
    --accent-soft: #EBEBEB;
    --accent: #0A0A0A;
    --accent-hover: #333333;
    --accent-foreground: #FFFFFF;
    --shadow-card: 0 0 0 1px var(--border), 0 2px 4px rgb(0 0 0 / 0.04);
    --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #09090B;
      --surface: #121214;
      --foreground: #EDEDED;
      --muted: #737373;
      --border: #202024;
      --accent-soft: #1F1F23;
      --accent: #FFFFFF;
      --accent-hover: #CCCCCC;
      --accent-foreground: #000000;
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 48px 24px;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font);
    -webkit-font-smoothing: antialiased;
  }
  .brand {
    position: fixed;
    top: 24px;
    left: 24px;
    display: inline-flex;
    align-items: center;
    color: var(--foreground);
  }
  .brand svg { width: 32px; height: 32px; }
  .card {
    width: 100%;
    max-width: 32rem;
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-card);
    text-align: center;
  }
  .code {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin: 0 auto 20px;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 600;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  p {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5rem;
  }
  .actions { margin-top: 28px; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 20px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-foreground);
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 150ms ease;
  }
  .btn:hover { background: var(--accent-hover); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 480px) {
    .card { padding: 28px 22px; }
  }
</style>
</head>
<body>
  <span class="brand" aria-label="uxcommunity">
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" transform="translate(-0.8 -0.8) scale(1.1)" d="M14.666 7C14.666 3.667 11.999 2 7.999 2C3.999 2 1.332 3.667 1.332 7C1.332 10.333 3.999 12 7.999 12V14C7.999 14 14.666 12 14.666 7Z M4.583 7a0.75 0.75 0 1 0 1.5 0a0.75 0.75 0 1 0-1.5 0Z M7.25 7a0.75 0.75 0 1 0 1.5 0a0.75 0.75 0 1 0-1.5 0Z M9.917 7a0.75 0.75 0 1 0 1.5 0a0.75 0.75 0 1 0-1.5 0Z"/>
    </svg>
  </span>

  <main class="card">
    <div class="code" aria-hidden="true">503</div>
    <h1>This page isn't working</h1>
    <p>Something went wrong on our side. Give it a moment, then reload.</p>
    <div class="actions">
      <a class="btn" href="">Reload</a>
    </div>
  </main>
</body>
</html>
`;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
  "X-Content-Type-Options": "nosniff",
};

export function isDocumentRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.headers.get("sec-fetch-dest") === "document") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

export function renderServiceUnavailablePage(): string {
  return SERVICE_UNAVAILABLE_PAGE;
}

export function serviceUnavailableResponse(request: Request): Response {
  const bodyless = request.method === "HEAD";

  if (isDocumentRequest(request)) {
    return new Response(bodyless ? null : SERVICE_UNAVAILABLE_PAGE, {
      status: 503,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return Response.json(
      { error: "Service unavailable. Please try again." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }

  return new Response(bodyless ? null : "Service unavailable", {
    status: 503,
    headers: {
      ...RESPONSE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function withServiceUnavailableFallback(
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  try {
    const response = await handle();
    if (response.status === 503 && isDocumentRequest(request)) {
      response.body?.cancel().catch(() => {});
      return serviceUnavailableResponse(request);
    }
    return response;
  } catch (error) {
    console.error(
      "web worker request failed",
      request.method,
      new URL(request.url).pathname,
      error,
    );
    return serviceUnavailableResponse(request);
  }
}
