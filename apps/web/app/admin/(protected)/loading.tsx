import { RouteLoader } from "@/components/ui/RouteLoader";

/**
 * Shown immediately when navigating to any /admin/* route while the
 * client component JS chunk loads. Plain spinner — no skeleton.
 */
export default function AdminLoading() {
  return <RouteLoader />;
}
