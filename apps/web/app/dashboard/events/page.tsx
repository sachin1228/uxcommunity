import { redirect } from "next/navigation";

/**
 * The city Events page is gone from the workspace nav. Event rooms still live
 * under `/dashboard/events/[eventId]`, and every event card / RSVP / community
 * Events tab is unchanged — old links to the list land on the feed instead.
 */
export default function EventsPage() {
  redirect("/dashboard");
}
