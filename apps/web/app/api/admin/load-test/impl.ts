/**
 * impl.ts — all k6 spawn logic lives here.
 *
 * IMPORTANT: k6 paths are built with Array.join('/') instead of path.resolve /
 * path.join on purpose. Turbopack has special-case static evaluation for
 * path.resolve() and path.join() — it normalises their results and tries to
 * resolve them as module import paths, which fails because the k6 directory
 * sits outside the Next.js app root. Array.join produces an unnormalised string
 * (e.g. "/abs/apps/web/../../k6/scripts/seed-users.js") that Turbopack does
 * NOT recognise as a server-relative module path. At runtime Node/spawn
 * normalises the path transparently.
 */
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

// Scenario paths — stored as plain strings; the k6 dir prefix is prepended below.
const SCENARIO_FILES: Record<string, string> = {
  smoke:           "scenarios/smoke.js",
  load:            "scenarios/load.js",
  stress:          "scenarios/stress.js",
  soak:            "scenarios/soak.js",
  chat_load:       "scenarios/chat_load.js",
  chat_concurrent: "scenarios/chat_concurrent.js",
  chat_flood:      "scenarios/chat_flood.js",
};

/**
 * Build a path to a file inside the k6 directory without using path.resolve or
 * path.join at the top level, so Turbopack's static path evaluator never sees a
 * normalised absolute path it could mistake for a module import.
 *
 * process.cwd() at runtime == <repo>/apps/web
 * Array.join keeps the /../.. segments so the string stays unnormalised for
 * Turbopack, while spawn/Node resolves them correctly at execution time.
 */
function k6Path(...segments: string[]): string {
  // Produce e.g. "/abs/apps/web/../../k6/scenarios/smoke.js"
  return [process.cwd(), "..", "..", "k6", ...segments].join("/");
}

/**
 * Flood and concurrent scenarios use pre-signed sessions from this local,
 * gitignored file. Validate it before spawning k6 so admins see the setup
 * problem in the runner instead of k6's opaque JSON parse exception.
 */
function validateSeededUsersFile(
  send: (line: string) => void,
  requiredUsers: number,
): boolean {
  const file = k6Path("data", "test-users.json");

  if (!fs.existsSync(file)) {
    send("ERROR: This scenario requires seeded k6 users.");
    send("  ✗ k6/data/test-users.json was not found");
    send("  Run the Seed Users tab first, then run the chat test again.");
    return false;
  }

  let users: unknown;
  try {
    users = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    send("ERROR: k6/data/test-users.json is not valid JSON.");
    send("  Run the Seed Users tab to regenerate it.");
    send("  Do not put an email address directly in k6/data/test-users.json.");
    return false;
  }

  if (!Array.isArray(users) || users.length === 0) {
    send("ERROR: k6/data/test-users.json contains no seeded users.");
    send("  Run the Seed Users tab first.");
    return false;
  }

  const missingSession = users.findIndex(
    (user) =>
      !user ||
      typeof user !== "object" ||
      typeof (user as { sessionToken?: unknown }).sessionToken !== "string" ||
      !(user as { sessionToken: string }).sessionToken,
  );
  if (missingSession !== -1) {
    send("ERROR: The seeded-user file has no pre-signed sessions.");
    send("  Run the Seed Users tab again to regenerate it.");
    return false;
  }

  if (users.length < requiredUsers) {
    send(`ERROR: ${requiredUsers} VUs requested, but only ${users.length} seeded users are available.`);
    send("  Increase Seed Users count and run the seeder again.");
    return false;
  }

  return true;
}

export async function handlePost(req: NextRequest): Promise<Response> {
  try {
    await requireSession("admin");
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { type } = body as { type: "test" | "seed" };

  // Repo root for spawn's cwd option — same unnormalised trick.
  const repoRoot = [process.cwd(), "..", ".."].join("/");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function send(line: string) {
        controller.enqueue(encoder.encode(line + "\n"));
      }

      let cmd: string;
      let args: string[];
      let env: NodeJS.ProcessEnv;

      if (type === "seed") {
        const { supabaseUrl, userCount } = body as {
          supabaseUrl: string;
          userCount: number;
        };

        if (!supabaseUrl) {
          send("ERROR: supabaseUrl is required");
          controller.close();
          return;
        }

        const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const sessionSecret = process.env.SESSION_SECRET;
        const communityId   = body.communityId || process.env.TEST_COMMUNITY_ID;

        if (!serviceKey || !sessionSecret || !communityId) {
          send("ERROR: Missing server-side env vars:");
          if (!serviceKey)    send("  ✗ SUPABASE_SERVICE_ROLE_KEY not set");
          if (!sessionSecret) send("  ✗ SESSION_SECRET not set");
          if (!communityId)   send("  ✗ TEST_COMMUNITY_ID not set (or pass communityId in form)");
          controller.close();
          return;
        }

        cmd  = "node";
        args = [k6Path("scripts", "seed-users.js")];
        env  = {
          ...process.env,
          SUPABASE_URL:              supabaseUrl,
          SUPABASE_SERVICE_ROLE_KEY: serviceKey,
          TEST_COMMUNITY_ID:         communityId,
          SESSION_SECRET:            sessionSecret,
          K6_USER_COUNT:             String(userCount || 200),
        };

        send(`▶ node k6/scripts/seed-users.js  (users: ${userCount || 200})`);
        send(`  SUPABASE_URL=${supabaseUrl}`);
        send(`  TEST_COMMUNITY_ID=${communityId}`);
        send("");

      } else {
        // type === "test"
        const {
          scenario, baseUrl, communityId, concurrentVus,
          floodVus, floodDuration,
          testUserEmail, testUserPass, adminEmail, adminPass,
        } = body as {
          scenario:      string;
          baseUrl:       string;
          communityId:   string;
          concurrentVus: number;
          floodVus:      number;
          floodDuration: string;
          testUserEmail: string;
          testUserPass:  string;
          adminEmail:    string;
          adminPass:     string;
        };

        const scenarioFile = SCENARIO_FILES[scenario];
        if (!scenarioFile) {
          send(`ERROR: Unknown scenario "${scenario}"`);
          controller.close();
          return;
        }
        if (!baseUrl || !communityId) {
          send("ERROR: baseUrl and communityId are required");
          controller.close();
          return;
        }

        const usesSeededUsers = scenario === "chat_flood" || scenario === "chat_concurrent";
        const requestedVus = scenario === "chat_flood"
          ? Number(floodVus || 500)
          : Number(concurrentVus || 50);
        if (usesSeededUsers && !validateSeededUsersFile(send, requestedVus)) {
          controller.close();
          return;
        }

        // Split on "/" so each segment is passed separately — avoids a single
        // "scenarios/smoke.js" literal that Turbopack could try to resolve.
        const [scenarioDir, scenarioFile_] = scenarioFile.split("/");

        cmd  = "k6";
        args = [
          "run",
          k6Path(scenarioDir, scenarioFile_),
          "-e", `BASE_URL=${baseUrl}`,
          "-e", `TEST_COMMUNITY_ID=${communityId}`,
          ...(concurrentVus ? ["-e", `CONCURRENT_VUS=${concurrentVus}`]     : []),
          ...(floodVus      ? ["-e", `FLOOD_VUS=${floodVus}`]               : []),
          ...(floodDuration ? ["-e", `FLOOD_DURATION=${floodDuration}`]     : []),
          ...(testUserEmail ? ["-e", `TEST_USER_EMAIL=${testUserEmail}`]     : []),
          ...(testUserPass  ? ["-e", `TEST_USER_PASSWORD=${testUserPass}`]   : []),
          ...(adminEmail    ? ["-e", `ADMIN_EMAIL=${adminEmail}`]            : []),
          ...(adminPass     ? ["-e", `ADMIN_PASSWORD=${adminPass}`]          : []),
        ];
        env = { ...process.env };

        send(`▶ k6 run ${scenarioFile}`);
        send(`  BASE_URL=${baseUrl}`);
        send(`  TEST_COMMUNITY_ID=${communityId}`);
        if (concurrentVus) send(`  CONCURRENT_VUS=${concurrentVus}`);
        if (testUserEmail) send(`  TEST_USER_EMAIL=${testUserEmail}`);
        if (adminEmail)    send(`  ADMIN_EMAIL=${adminEmail}`);
        send("");
      }

      const child = spawn(cmd, args, {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (line) send(line);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (line) send(line);
        }
      });

      child.on("close", (code) => {
        send("");
        send(code === 0
          ? "✅ Completed successfully (exit 0)"
          : `❌ Exited with code ${code}`
        );
        controller.close();
      });

      child.on("error", (err) => {
        send(`ERROR spawning process: ${err.message}`);
        if (err.message.includes("ENOENT")) {
          send(`  Make sure "${cmd}" is installed and on PATH.`);
          if (cmd === "k6") send("  Install: https://k6.io/docs/get-started/installation/");
        }
        controller.close();
      });

      // Abort if the client disconnects
      req.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/plain; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Cache-Control":     "no-cache",
    },
  });
}

// Re-export path utility for any callers that need it
export { path };
