import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const deploy = readFileSync(`${root}.github/workflows/deploy.yml`, "utf8");
const ci = readFileSync(`${root}.github/workflows/ci.yml`, "utf8");
const staging = readFileSync(`${root}.github/workflows/staging.yml`, "utf8");

const MAIN_AND_CONFIRMATION =
  /github\.ref == 'refs\/heads\/main'[\s\S]{0,120}?inputs\.confirmation == 'DEPLOY_PRODUCTION'/;

function jobBlock(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `job ${name} must exist`);
  const lines = workflow.slice(start).split("\n");
  let end = lines.length;
  for (let i = 2; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(0, end).join("\n");
}

test("CI is reusable and the production deploy calls it for the same run", () => {
  assert.match(ci, /^on:[\s\S]*workflow_call:/m);
  assert.match(deploy, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(jobBlock(deploy, "deploy"), /needs: ci/);
  assert.match(jobBlock(deploy, "ci"), MAIN_AND_CONFIRMATION);
  assert.match(jobBlock(deploy, "deploy"), MAIN_AND_CONFIRMATION);
});

test("a failed, cancelled or skipped CI job cannot start the deploy", () => {
  const deployJob = jobBlock(deploy, "deploy");
  assert.match(deployJob, /needs\.ci\.result == 'success'/);
  assert.doesNotMatch(deployJob, /if:\s*always\(\)/);
  assert.doesNotMatch(deployJob, /continue-on-error/);
  // A skipped `ci` job (wrong confirmation / non-main ref) leaves the deploy
  // condition false because the result is `skipped`.
  assert.match(deployJob, /inputs\.confirmation == 'DEPLOY_PRODUCTION'/);
  assert.match(deployJob, /github\.ref == 'refs\/heads\/main'/);
});

test("the deploy checkout and the guard are pinned to the dispatched SHA", () => {
  const deployJob = jobBlock(deploy, "deploy");
  assert.match(deployJob, /actions\/checkout@v4[\s\S]{0,80}?ref: \$\{\{ github\.sha \}\}/);
  assert.match(deployJob, /EXPECTED_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(deployJob, /run: bash scripts\/verify-release-commit\.sh/);
  assert.match(deployJob, /environment: Production/);
});

test("a queued release is rejected if main moved", () => {
  assert.match(deploy, /scripts\/verify-release-commit\.sh/);
  const guard = readFileSync(`${root}scripts/verify-release-commit.sh`, "utf8");
  assert.match(guard, /git ls-remote origin refs\/heads\/main/);
  assert.match(guard, /main moved to/);
  assert.match(guard, /Could not read refs\/heads\/main/);
});

test("production is not cancelled mid-flight and CI cannot be cross-cancelled", () => {
  assert.match(
    deploy,
    /concurrency:\s*\n\s*group: deploy-\$\{\{ github\.ref \}\}\s*\n\s*cancel-in-progress: false/,
  );
  const group = ci.match(/concurrency:\s*\n\s*group: (ci-[^\n]+)/)?.[1] ?? "";
  assert.match(group, /github\.event_name/);
  assert.match(group, /github\.run_id/);
  assert.match(ci, /concurrency:\s*\n\s*group: [^\n]+\n\s*cancel-in-progress: true/);
});

test("staging remains independent of the production gate", () => {
  assert.match(staging, /push:\s*\n\s*branches: \[main\]/);
  assert.doesNotMatch(staging, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(staging, /needs: ci/);
  assert.match(staging, /npm run test:environments/);
});

test("the reusable CI keeps the blocking release jobs", () => {
  const tests = jobBlock(ci, "tests");
  const realtime = jobBlock(ci, "realtime");
  const build = jobBlock(ci, "web-build");
  assert.match(tests, /npx tsx --tsconfig tsconfig\.json --test/);
  assert.doesNotMatch(tests, /continue-on-error/);
  assert.match(realtime, /npm run test:realtime --workspace=apps\/realtime/);
  assert.doesNotMatch(realtime, /continue-on-error/);
  assert.match(build, /npm run build/);
  assert.doesNotMatch(build, /continue-on-error/);
});
