import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verify-release-commit.sh", import.meta.url));
const identity = {
  GIT_AUTHOR_NAME: "Stage 3",
  GIT_AUTHOR_EMAIL: "stage3@example.invalid",
  GIT_COMMITTER_NAME: "Stage 3",
  GIT_COMMITTER_EMAIL: "stage3@example.invalid",
};

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...identity },
  }).trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "uxc-release-commit-"));
  const bare = join(root, "origin.git");
  const clone = join(root, "clone");
  execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
  execFileSync("git", ["clone", bare, clone], { stdio: "ignore" });
  git(clone, "checkout", "-b", "main");
  writeFileSync(join(clone, "release.txt"), "a");
  git(clone, "add", "release.txt");
  git(clone, "commit", "-m", "release A");
  const first = git(clone, "rev-parse", "HEAD");
  git(clone, "push", "-u", "origin", "main");
  return { root, bare, clone, first };
}

function runGuard(cwd, expected) {
  return spawnSync("bash", [script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, EXPECTED_SHA: expected, GITHUB_SHA: "", CI_RESULT: "success" },
  });
}

test("accepts the dispatched commit while main still points at it", () => {
  const repo = makeRepo();
  try {
    const result = runGuard(repo.clone, repo.first);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release commit is still the head of main/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("rejects a queued release after main moves", () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.clone, "release.txt"), "b");
    git(repo.clone, "add", "release.txt");
    git(repo.clone, "commit", "-m", "release B");
    git(repo.clone, "push", "origin", "main");
    // The deployment checkout is pinned to the dispatched SHA while main has
    // already advanced; model that detached checkout explicitly.
    git(repo.clone, "checkout", repo.first);

    const result = runGuard(repo.clone, repo.first);
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /main moved to/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("rejects a checkout that is not the dispatched commit", () => {
  const repo = makeRepo();
  try {
    const result = runGuard(repo.clone, "0000000000000000000000000000000000000000");
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /this release was dispatched for/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});
