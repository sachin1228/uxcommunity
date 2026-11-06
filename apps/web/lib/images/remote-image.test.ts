import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { isOptimizableImageUrl } from "./remote-image";

const originalR2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
const originalSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  if (originalR2 === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  else process.env.NEXT_PUBLIC_R2_PUBLIC_URL = originalR2;
  if (originalSupabase === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabase;
});

test("R2 media is eligible for resizing", () => {
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://media.example.in";
  assert.equal(isOptimizableImageUrl("https://media.example.in/avatars/a.webp"), true);
});

test("Supabase public storage is eligible, signed paths are not", () => {
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  assert.equal(
    isOptimizableImageUrl("https://project.supabase.co/storage/v1/object/public/avatars/a.webp"),
    true,
  );
  assert.equal(
    isOptimizableImageUrl("https://project.supabase.co/storage/v1/object/sign/avatars/a.webp"),
    false,
  );
});

test("unknown hosts, relative paths and data URLs stay plain img", () => {
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://media.example.in";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  assert.equal(isOptimizableImageUrl("https://images.unsplash.com/photo.jpg"), false);
  assert.equal(isOptimizableImageUrl("/logo.png"), false);
  assert.equal(isOptimizableImageUrl("data:image/png;base64,abc"), false);
  assert.equal(isOptimizableImageUrl(null), false);
});
