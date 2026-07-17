import { redirect } from "next/navigation";

/**
 * /login now redirects to the root route (/).
 * The login page lives at app/page.tsx.
 */
export default function LoginRedirect() {
  redirect("/");
}
