import { DashboardContentLoader } from "../../ContentLoader";

/**
 * Showcase detail loading boundary — matches the view page layout: spinner in
 * the middle feed area and the Discover sidebar. No homepage composer header.
 */
export default function ShowcaseDetailLoading() {
  return <DashboardContentLoader />;
}