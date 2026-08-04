export const dynamic = "force-dynamic";

import SherlockGraphExplorer from "@/components/SherlockGraphExplorer";

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ story?: string; section?: string; character?: string }>;
}) {
  return <SherlockGraphExplorer searchParams={await searchParams} devTools />;
}
