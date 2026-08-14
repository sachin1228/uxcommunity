import { DashboardContentLoader } from "../../ContentLoader";

/**
 * Resource detail loading boundary — matches the view page layout: spinner in
 * the middle feed area and the Discover sidebar. No homepage composer header.
 */
export default function ResourceDetailLoading() {
  return <DashboardContentLoader />;
}
