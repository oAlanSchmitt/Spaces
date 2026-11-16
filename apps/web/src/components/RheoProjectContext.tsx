import { Button, Icon } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { RheoKnowledgeDialog } from "@/components/RheoKnowledgeDialog";
import { SpacesCodexHandoff } from "@/components/SpacesCodexHandoff";
import { SpacesProjectWork } from "@/components/SpacesProjectWork";
import { rheoOverviewKey, rheoSpacesApi } from "@/lib/rheo-spaces";
import "./rheo-knowledge.css";

/** Only account metadata is read here. Document bodies are requested after the owner opens Knowledge. */
export function RheoProjectContext() {
  const { org, me } = useOrg();
  const { t } = useTranslation();
  const [knowledge, setKnowledge] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [spaceKnowledge, setSpaceKnowledge] = useState(false);
  const [work, setWork] = useState(false);
  const overview = useQuery({
    queryKey: rheoOverviewKey(me.user.id),
    queryFn: rheoSpacesApi.overview,
    staleTime: 60000,
    retry: false,
    meta: { quiet: true },
  });
  const context = overview.data?.businesses.flatMap((business) =>
    business.spaces.flatMap((space) =>
      space.projects.filter((project) => project.orgId === org.id).map((project) => ({ business, space, project })),
    ),
  )[0];
  if (!context) return null;
  return (
    <>
      <nav className="rheo-project-context" aria-label={t("rheoSpaces.currentProject")}>
        <ol>
          <li>
            <Link className="ac-link" to="/org/$orgId/spaces" params={{ orgId: org.id }}>
              {t("rheoSpaces.title")}
            </Link>
          </li>
          <li>{context.business.name}</li>
          <li>{context.space.name}</li>
          <li aria-current="page">{context.project.name}</li>
        </ol>
        <span className="rheo-project-context__profile">
          <Icon name="lock" size={14} />
          {t("rheoSpaces.restrictedProfile")}
        </span>
        <Button size="sm" variant="link" onClick={() => setKnowledge(true)}>
          {t("rheoSpaces.knowledge.open")}
        </Button>
        <Button size="sm" variant="link" onClick={() => setSpaceKnowledge(true)}>
          {t("rheoSpaces.knowledge.sharedOpen")}
        </Button>
        <Button size="sm" variant="link" onClick={() => setWork(true)}>
          {t("rheoSpaces.work.open")}
        </Button>
      </nav>
      {knowledge && (
        <RheoKnowledgeDialog
          key={context.project.orgId}
          project={context.project}
          onClose={() => setKnowledge(false)}
        />
      )}
      {handoff === context.project.id && (
        <SpacesCodexHandoff project={context.project} onClose={() => setHandoff(null)} />
      )}
      {spaceKnowledge && (
        <RheoKnowledgeDialog key={context.space.id} space={context.space} onClose={() => setSpaceKnowledge(false)} />
      )}
      {work && (
        <SpacesProjectWork
          project={context.project}
          onClose={() => setWork(false)}
          onHandoff={() => {
            setHandoff(context.project.id);
            setWork(false);
          }}
        />
      )}
    </>
  );
}
