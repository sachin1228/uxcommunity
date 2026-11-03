const SERVICE_UNAVAILABLE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#FAFAFA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#09090B" media="(prefers-color-scheme: dark)">
<title>503 — Temporarily unavailable · uxcommunity</title>
<style>
  :root {
    color-scheme: light dark;
    --background: #FAFAFA;
    --foreground: #0A0A0A;
    --muted: #737373;
    --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #09090B;
      --foreground: #EDEDED;
      --muted: #737373;
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
    padding: 48px 24px 88px;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font);
    -webkit-font-smoothing: antialiased;
  }
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .planet {
    width: 78px;
    height: 56px;
    margin-bottom: 26px;
    color: var(--foreground);
    opacity: 0.9;
  }
  h1 {
    margin: 0;
    color: transparent;
    -webkit-text-stroke: 2px var(--foreground);
    font-size: clamp(112px, 27vw, 208px);
    font-weight: 800;
    line-height: 0.78;
    letter-spacing: -0.055em;
  }
  p {
    margin: 24px 0 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--foreground);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    margin-top: 32px;
    padding: 0 26px;
    border: 1px solid var(--foreground);
    border-radius: 9999px;
    background: transparent;
    color: var(--foreground);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-decoration: none;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease;
  }
  .btn:hover { background: var(--foreground); color: var(--background); }
  .btn:focus-visible { outline: 2px solid var(--foreground); outline-offset: 3px; }
  .brand {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 0.01em;
  }
  .brand svg { width: 16px; height: 16px; }
</style>
</head>
<body>
  <main>
    <svg class="planet" viewBox="0 0 120 84" fill="none" aria-hidden="true">
      <circle cx="60" cy="42" r="21" stroke="currentColor" stroke-width="1.5"/>
      <ellipse cx="60" cy="42" rx="43" ry="10.5" transform="rotate(-18 60 42)" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="51" cy="34" r="2.5" fill="currentColor" opacity="0.7"/>
    </svg>

    <h1 aria-label="Error 503">503</h1>
    <p>The server is temporarily busy.<br>Please try again later.</p>
    <a class="btn" href="">Try again</a>
  </main>

  <footer class="brand" aria-label="uxcommunity">
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" transform="translate(-0.8 -0.8) scale(1.1)" d="M14.666 7C14.666 3.667 11.999 2 7.999 2C3.999 2 1.332 3.667 1.332 7C1.332 10.333 3.999 12 7.999 12V14C7.999 14 14.666 12 14.666 7Z M4.583 7a0.75 0.75 0 1 0 1.5 0a0.75 0.75 0 1 0-1.5 0Z M7.25 7a0.75.75 0 1 0 1.5 0a0.75 0.75 0 1 0-1.5 0Z M9.917 7a0.75.75 0 1 0 1.5 0a0.75.75 0 1 0-1.5 0Z"/>
    </svg>
    <span>uxcommunity</span>
  </footer>
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
