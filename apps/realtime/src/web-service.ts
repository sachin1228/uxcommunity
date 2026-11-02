import { fetchIsolatedService } from "../../../packages/shared/src/environment";
import type { Env } from "./env";

/** Staging workers.dev peers communicate through an explicit staging binding. */
export function fetchWebService(env: Env, url: string, init: RequestInit): Promise<Response> {
  if (env.APP_ENV === "staging" && !env.WEB_SERVICE) throw new Error("Staging web service binding is required");
  return fetchIsolatedService(url, init,
    { APP_ENV: env.APP_ENV, STAGING_ALLOWED_ORIGINS: env.STAGING_ALLOWED_ORIGINS },
    env.APP_ENV === "staging" ? env.WEB_SERVICE!.fetch.bind(env.WEB_SERVICE) : fetch);
}
