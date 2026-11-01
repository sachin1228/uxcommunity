import { assertWebEnvironment } from "@uxcommunity/shared";

export function register() {
  assertWebEnvironment(process.env);
}
