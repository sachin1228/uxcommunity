import { DashboardContentLoader } from "../../ContentLoader";

/**
 * Event detail loading boundary — matches the view page layout: spinner in
 * the middle feed area and the Discover sidebar. No homepage composer header.
 */
export default function EventDetailLoading() {
  return <DashboardContentLoader />;
}
