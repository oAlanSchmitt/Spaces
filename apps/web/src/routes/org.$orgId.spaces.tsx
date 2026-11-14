import { createFileRoute } from "@tanstack/react-router";
import { Main } from "@/components/Main";
import { RheoSpacesPage } from "@/pages/RheoSpacesPage";

export const Route = createFileRoute("/org/$orgId/spaces")({
  component: () => (
    <Main>
      <RheoSpacesPage />
    </Main>
  ),
});
