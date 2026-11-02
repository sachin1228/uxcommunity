import { assertWebEnvironment } from "@uxcommunity/shared";

export function register() {
  assertWebEnvironment(process.env);
  if (process.env.NEXT_PUBLIC_APP_ENV !== process.env.APP_ENV) {
    throw new Error("Compiled client environment does not match the server environment");
  }
}
