"use client";

import { useState } from "react";
import { MasterDataPage } from "@/components/admin/MasterDataPage";
import { FetchMasterImages } from "@/components/admin/masterData/FetchMasterImages";
import type { MasterTable } from "@/lib/master-data/master-tables";

interface MasterDataPageWithFetchProps {
  title: string;
  entity: string;
  apiBase: string;
  basePath: string;
  responseKey?: string;
  /** Display name of the entity used by the fetch button, e.g. "City". */
  fetchEntity: string;
  /** Master-data table the fetch button updates. */
  fetchTable: MasterTable;
}

export function MasterDataPageWithFetch({
  title,
  entity,
  apiBase,
  basePath,
  responseKey,
  fetchEntity,
  fetchTable,
}: MasterDataPageWithFetchProps) {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <MasterDataPage
      title={title}
      entity={entity}
      apiBase={apiBase}
      basePath={basePath}
      responseKey={responseKey}
      headerExtra={
        <FetchMasterImages
          entity={fetchEntity}
          table={fetchTable}
          apiBase={apiBase}
          onUpdated={() => setRefreshSignal((n) => n + 1)}
        />
      }
      refreshSignal={refreshSignal}
    />
  );
}