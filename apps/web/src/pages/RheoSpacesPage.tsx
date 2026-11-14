import { keys, useMe } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Field,
  GroupHeading,
  Icon,
  Input,
  Locked,
  PageHeader,
  Select,
} from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import { RheoKnowledgeDialog } from "@/components/RheoKnowledgeDialog";
import { SpacesCodexConnection } from "@/components/SpacesCodexConnection";
import {
  type RheoCreate,
  type RheoOverview,
  type RheoProject,
  rheoOverviewKey,
  rheoSpacesApi,
} from "@/lib/rheo-spaces";
import "./rheo-spaces.css";

/** The hierarchy belongs to the account. Opening a project uses its native, isolated workspace and channel. */
export function RheoSpacesPage({ onPrepared }: { onPrepared?: (controlOrgId: string) => void }) {
  const { t } = useTranslation();
  const me = useMe().data;
  const client = useQueryClient();
  const queryKey = rheoOverviewKey(me?.user.id ?? "");
  const list = useQuery({ queryKey, queryFn: rheoSpacesApi.overview, enabled: Boolean(me) });
  const [creating, setCreating] = useState<RheoCreate | null>(null);
  const [knowledge, setKnowledge] = useState<RheoProject | null>(null);
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey }), client.invalidateQueries({ queryKey: keys.me })]);
  };
  const bootstrap = useMutation({
    meta: { silent: true },
    mutationFn: rheoSpacesApi.bootstrap,
    onSuccess: async (overview) => {
      client.setQueryData(queryKey, overview);
      await client.invalidateQueries({ queryKey: keys.me });
    },
  });
  const state = useMutation({
    meta: { silent: true },
    mutationFn: (project: RheoProject) =>
      rheoSpacesApi.setState(project, project.state === "active" ? "archived" : "active"),
    onSuccess: refresh,
  });
  const data = list.data;
  useEffect(() => {
    if (data?.controlOrgId && !bootstrap.isPending) onPrepared?.(data.controlOrgId);
  }, [data?.controlOrgId, bootstrap.isPending, onPrepared]);
  return (
    <div className="page page--list rheo-spaces">
      <PageHeader
        title={t("rheoSpaces.title")}
        meta={t("rheoSpaces.hierarchy")}
        actions={
          data?.controlOrgId && (
            <Button variant="primary" icon="plus" onClick={() => setCreating({ kind: "business" })}>
              {t("rheoSpaces.newBusiness")}
            </Button>
          )
        }
      />
      <SpacesCodexConnection />
      {list.isLoading && <LoadingList avatar={false} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {data && !data.controlOrgId && (
        <EmptyState
          icon="layers"
          title={t("rheoSpaces.startTitle")}
          actions={
            <Button variant="primary" onClick={() => bootstrap.mutate()} loading={bootstrap.isPending}>
              {t("rheoSpaces.start")}
            </Button>
          }
        >
          {t("rheoSpaces.startText")}
        </EmptyState>
      )}
      {bootstrap.isError && (
        <p role="alert" className="ac-field__error">
          {errorText(t, bootstrap.error)}
        </p>
      )}
      {data?.controlOrgId && (
        <>
          <section className="ac-card rheo-spaces__coordinator" aria-label={t("rheoSpaces.coordinator")}>
            <div className="rheo-spaces__context">
              <h2 className="rheo-spaces__name">
                <Icon name="agent" />
                {t("rheoSpaces.coordinator")}
              </h2>
              <p className="muted small">{t("rheoSpaces.protectedProfile")}</p>
            </div>
            <Button asChild>
              {data.controlChannelId ? (
                <Link
                  to="/org/$orgId/c/$channelId"
                  params={{ orgId: data.controlOrgId, channelId: data.controlChannelId }}
                >
                  {t("rheoSpaces.openCoordinator")}
                </Link>
              ) : (
                <Link to="/org/$orgId/home" params={{ orgId: data.controlOrgId }}>
                  {t("rheoSpaces.openCoordinator")}
                </Link>
              )}
            </Button>
          </section>
          {data.businesses.length === 0 && (
            <EmptyState icon="layers" title={t("rheoSpaces.noBusinesses")}>
              {t("rheoSpaces.noBusinessesText")}
            </EmptyState>
          )}
          <div className="ac-groups">
            {data.businesses.map((business) => (
              <section className="rheo-spaces__business" key={business.id} aria-label={business.name}>
                <GroupHeading
                  title={business.name}
                  note={t("rheoSpaces.business")}
                  aside={
                    <Button
                      size="sm"
                      icon="plus"
                      aria-label={t("rheoSpaces.newSpaceIn", { name: business.name })}
                      onClick={() => setCreating({ kind: "space", parentId: business.id, parentName: business.name })}
                    >
                      {t("rheoSpaces.newSpace")}
                    </Button>
                  }
                />
                {business.spaces.length === 0 && (
                  <p className="muted small rheo-spaces__empty">{t("rheoSpaces.noSpaces")}</p>
                )}
                <div className="rheo-spaces__spaces">
                  {business.spaces.map((space) => (
                    <section className="ac-card rheo-spaces__space" key={space.id} aria-label={space.name}>
                      <GroupHeading
                        level={3}
                        title={space.name}
                        note={t("rheoSpaces.space")}
                        aside={
                          <Button
                            size="sm"
                            icon="plus"
                            aria-label={t("rheoSpaces.newProjectIn", { name: space.name })}
                            onClick={() => setCreating({ kind: "project", parentId: space.id, parentName: space.name })}
                          >
                            {t("rheoSpaces.newProject")}
                          </Button>
                        }
                      />
                      {space.projects.length === 0 ? (
                        <p className="muted small rheo-spaces__empty">{t("rheoSpaces.noProjects")}</p>
                      ) : (
                        <ul className="rheo-spaces__projects">
                          {space.projects.map((project) => (
                            <li className="rheo-spaces__project" key={project.id}>
                              <div className="rheo-spaces__context">
                                <h4 className="rheo-spaces__name">{project.name}</h4>
                                <span className="small muted">
                                  {t(
                                    project.state === "archived" ? "rheoSpaces.archived" : "rheoSpaces.projectContext",
                                  )}
                                </span>
                              </div>
                              <div className="ac-acts rheo-spaces__actions">
                                <Button
                                  size="sm"
                                  variant="link"
                                  aria-label={t("rheoSpaces.knowledge.openName", { name: project.name })}
                                  onClick={() => setKnowledge(project)}
                                >
                                  {t("rheoSpaces.knowledge.open")}
                                </Button>
                                <Button
                                  variant="link"
                                  aria-label={t(
                                    project.state === "active" ? "rheoSpaces.archiveName" : "rheoSpaces.reopenName",
                                    { name: project.name },
                                  )}
                                  disabled={state.isPending}
                                  onClick={() => state.mutate(project)}
                                >
                                  {t(project.state === "active" ? "rheoSpaces.archive" : "rheoSpaces.reopen")}
                                </Button>
                                <Button size="sm" asChild>
                                  <Link
                                    to="/org/$orgId/c/$channelId"
                                    params={{ orgId: project.orgId, channelId: project.channelId }}
                                    aria-label={t("rheoSpaces.openProject", { name: project.name })}
                                  >
                                    {t("rheoSpaces.open")}
                                  </Link>
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {state.isError && (
            <p role="alert" className="ac-field__error">
              {errorText(t, state.error)}
            </p>
          )}
        </>
      )}
      {creating && data && (
        <CreateDialog
          target={creating}
          templates={data.templates}
          onClose={() => setCreating(null)}
          onCreated={refresh}
        />
      )}
      {knowledge && <RheoKnowledgeDialog project={knowledge} onClose={() => setKnowledge(null)} />}
      <p className="page-description">
        Based on{" "}
        <a href="https://agentes.chat" target="_blank" rel="noreferrer">
          agentes.chat by Codari Global, LLC
        </a>
        .
      </p>
    </div>
  );
}

function CreateDialog({
  target,
  templates,
  onClose,
  onCreated,
}: {
  target: RheoCreate;
  templates: RheoOverview["templates"];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () => rheoSpacesApi.create(target, name.trim(), templateId, requestKey),
    onSuccess: async () => {
      await onCreated();
      onClose();
    },
  });
  const title = t(
    target.kind === "business"
      ? "rheoSpaces.newBusiness"
      : target.kind === "space"
        ? "rheoSpaces.newSpace"
        : "rheoSpaces.newProject",
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
      title={title}
      description={target.kind === "business" ? undefined : target.parentName}
      closeLabel={t("common.close")}
      width={440}
      unsaved={Boolean(name)}
    >
      <form
        style={{ display: "contents" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <Locked when={create.isPending}>
          <DialogBody>
            <Field label={t("rheoSpaces.name")}>
              <Input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setRequestKey(crypto.randomUUID());
                }}
              />
            </Field>
            {target.kind === "project" && templates.length > 0 && (
              <Field
                label={t("rheoSpaces.template")}
                hint={{
                  name: t("common.about", { label: t("rheoSpaces.template") }),
                  text: t("rheoSpaces.protectedProfile"),
                }}
              >
                <Select
                  value={templateId}
                  onValueChange={(value) => {
                    setTemplateId(value);
                    setRequestKey(crypto.randomUUID());
                  }}
                  options={[
                    { value: "", label: t("rheoSpaces.defaultTemplate") },
                    ...templates.map((template) => ({ value: template.id, label: template.name })),
                  ]}
                />
              </Field>
            )}
            {create.isError && (
              <p role="alert" className="ac-field__error">
                {errorText(t, create.error)}
              </p>
            )}
          </DialogBody>
        </Locked>
        <DialogFooter>
          <Button onClick={onClose} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim() || create.isPending}
          >
            {t("rheoSpaces.create")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
