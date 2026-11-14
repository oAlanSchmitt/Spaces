import { useMe } from "@agenteschat/client";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useServerLocale } from "@/i18n";
import { RheoSpacesPage } from "@/pages/RheoSpacesPage";

/** First access and New workspace both enter the protected account catalog. */
export function RheoStartPage() {
  useServerLocale(useMe().data?.user);
  const navigate = useNavigate();
  const openCatalog = useCallback(
    (controlOrgId: string) => {
      void navigate({ to: "/org/$orgId/spaces", params: { orgId: controlOrgId }, replace: true });
    },
    [navigate],
  );
  return (
    <main className="shell__main">
      <RheoSpacesPage onPrepared={openCatalog} />
    </main>
  );
}
