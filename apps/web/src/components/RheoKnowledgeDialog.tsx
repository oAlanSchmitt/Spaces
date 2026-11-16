import { errorText } from "@agenteschat/client/lib/errors";
import { formatFullDate } from "@agenteschat/client/lib/format";
import {
  Button,
  DetailsDialog,
  DetailsSection,
  EmptyState,
  Field,
  Input,
  Locked,
  Select,
  TabPanel,
  Tabs,
  Textarea,
} from "@agenteschat/ui";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import {
  type RheoEntry,
  type RheoProject,
  type RheoSpace,
  rheoKnowledgeKey,
  rheoSpaceKnowledgeKey,
  rheoSpacesApi,
} from "@/lib/rheo-spaces";
import "./rheo-knowledge.css";

type KnowledgeProps = (
  | { project: RheoProject; space?: never }
  | { space: Pick<RheoSpace, "id" | "name">; project?: never }
) & { onClose: () => void };

/** Mounted only after a person opens it. The account hierarchy never requests the knowledge bodies. */
export function RheoKnowledgeDialog(props: KnowledgeProps) {
  const { me } = useOrg();
  return (
    <KnowledgeSession key={`${me.user.id}:${props.space?.id ?? props.project?.orgId}`} {...props} userId={me.user.id} />
  );
}

function KnowledgeSession({ project, space, onClose, userId }: KnowledgeProps & { userId: string }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const queryKey = space ? rheoSpaceKnowledgeKey(userId, space.id) : rheoKnowledgeKey(userId, project.orgId);
  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      space ? rheoSpacesApi.spaceKnowledge(space.id, pageParam) : rheoSpacesApi.knowledge(project.orgId, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    gcTime: 0,
    refetchOnMount: "always",
  });
  const [tab, setTab] = useState("entries");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RheoEntry | null>(null);
  const [kind, setKind] = useState<RheoEntry["kind"]>("document");
  const [visibility, setVisibility] = useState<RheoEntry["visibility"]>("owner");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const refresh = async () => {
    await client.invalidateQueries({ queryKey });
    if (space) await client.invalidateQueries({ queryKey: ["rheo-knowledge", userId] });
  };
  const create = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      space
        ? editing
          ? rheoSpacesApi.updateSpaceEntry(space.id, editing.id, {
              title: title.trim(),
              body,
              visibility,
              revision: editing.revision,
            })
          : rheoSpacesApi.addSpaceEntry(space.id, { kind, title: title.trim(), body, visibility })
        : rheoSpacesApi.addEntry(project.orgId, { kind, title: title.trim(), body, visibility }),
    onSuccess: async () => {
      await refresh();
      setTitle("");
      setBody("");
      setAdding(false);
      setEditing(null);
    },
  });
  const review = useMutation({
    meta: { silent: true },
    mutationFn: ({ id, state, revision }: { id: string; state: "approved" | "archived"; revision: number }) =>
      space
        ? rheoSpacesApi.updateSpaceEntry(space.id, id, { state, revision })
        : rheoSpacesApi.reviewEntry(project.orgId, id, state),
    onSuccess: refresh,
  });
  const data = list.data?.pages[0];
  const entries = list.data?.pages.flatMap((page) => page.entries) ?? [];
  const archived = data?.state === "archived";
  const receipts = [...(data?.receipts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <DetailsDialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending && !review.isPending) onClose();
      }}
      title={t(space ? "rheoSpaces.knowledge.spaceTitle" : "rheoSpaces.knowledge.title")}
      subtitle={space?.name ?? project?.name}
      closeLabel={t("common.close")}
      className="rheo-knowledge"
      unsaved={Boolean(title || body)}
    >
      <DetailsSection>
        <p className="muted small">{t("rheoSpaces.knowledge.privateHelp")}</p>
        <p className="muted small">
          {t(space ? "rheoSpaces.knowledge.spaceHelp" : "rheoSpaces.knowledge.inheritedHelp")}
        </p>
        {archived && (
          <p role="status" className="muted small">
            {t("rheoSpaces.knowledge.archivedHelp")}
          </p>
        )}
        {list.isLoading && <LoadingList avatar={false} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {data && (
          <Tabs
            value={tab}
            onValueChange={setTab}
            label={t(space ? "rheoSpaces.knowledge.spaceTitle" : "rheoSpaces.knowledge.title")}
            items={[
              { value: "entries", label: t("rheoSpaces.knowledge.content"), count: entries.length },
              ...(!space
                ? [{ value: "sources", label: t("rheoSpaces.knowledge.sources"), count: receipts.length }]
                : []),
            ]}
          >
            <TabPanel value="entries">
              <div className="rheo-knowledge__stack">
                {!adding && !archived && (
                  <div>
                    <Button
                      size="sm"
                      icon="plus"
                      onClick={() => {
                        setEditing(null);
                        setKind("document");
                        setVisibility("owner");
                        setAdding(true);
                      }}
                    >
                      {t("rheoSpaces.knowledge.add")}
                    </Button>
                  </div>
                )}
                {adding && (
                  <form
                    className="ac-card rheo-knowledge__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (title.trim() && body.trim() && !create.isPending) create.mutate();
                    }}
                  >
                    <Locked when={create.isPending}>
                      {!editing && (
                        <Field label={t("rheoSpaces.knowledge.kind")}>
                          <Select
                            value={kind}
                            onValueChange={setKind}
                            options={(["document", "memory", "task"] as const).map((value) => ({
                              value,
                              label: t(`rheoSpaces.knowledge.kinds.${value}`),
                            }))}
                          />
                        </Field>
                      )}
                      <Field label={t("rheoSpaces.knowledge.entryTitle")}>
                        <Input
                          required
                          maxLength={160}
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                        />
                      </Field>
                      <Field label={t("rheoSpaces.knowledge.body")}>
                        <Textarea
                          required
                          maxLength={40000}
                          rows={5}
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                        />
                      </Field>
                      <Field label={t("rheoSpaces.knowledge.visibility")}>
                        <Select
                          value={visibility}
                          onValueChange={setVisibility}
                          options={(["owner", "project"] as const).map((value) => ({
                            value,
                            label: t(
                              space && value === "project"
                                ? "rheoSpaces.knowledge.spaceVisibility"
                                : `rheoSpaces.knowledge.visibilityOptions.${value}`,
                            ),
                          }))}
                        />
                      </Field>
                      {create.isError && (
                        <p role="alert" className="ac-field__error">
                          {errorText(t, create.error)}
                        </p>
                      )}
                    </Locked>
                    <div className="ac-acts rheo-knowledge__actions">
                      <Button
                        size="sm"
                        disabled={create.isPending}
                        onClick={() => {
                          setAdding(false);
                          setTitle("");
                          setBody("");
                          setEditing(null);
                          create.reset();
                        }}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        type="submit"
                        variant="primary"
                        disabled={!title.trim() || !body.trim() || create.isPending}
                        loading={create.isPending}
                      >
                        {t("rheoSpaces.knowledge.save")}
                      </Button>
                    </div>
                  </form>
                )}
                {entries.length === 0 && <EmptyState icon="document">{t("rheoSpaces.knowledge.empty")}</EmptyState>}
                {entries.map((entry) => (
                  <article key={entry.id} className="ac-card rheo-knowledge__entry" aria-label={entry.title}>
                    <div className="rheo-knowledge__entry-head">
                      <h3>{entry.title}</h3>
                      <p className="small muted">
                        {t(`rheoSpaces.knowledge.kinds.${entry.kind}`)} ·{" "}
                        {t(
                          entry.spaceId && entry.visibility === "project"
                            ? "rheoSpaces.knowledge.spaceVisibility"
                            : `rheoSpaces.knowledge.visibilityOptions.${entry.visibility}`,
                        )}{" "}
                        · {t(`rheoSpaces.knowledge.states.${entry.state}`)}
                      </p>
                    </div>
                    {entry.spaceId && (
                      <p className="small muted">
                        {t("rheoSpaces.knowledge.fromSpace")} ·{" "}
                        {t("rheoSpaces.knowledge.revision", { revision: entry.revision })}
                      </p>
                    )}
                    <p className="rheo-knowledge__body">{entry.body}</p>
                    {!archived && entry.state !== "archived" && (space || !entry.spaceId) && (
                      <div className="ac-acts rheo-knowledge__actions">
                        {space && !adding && (
                          <Button
                            size="sm"
                            disabled={review.isPending}
                            onClick={() => {
                              setEditing(entry);
                              setKind(entry.kind);
                              setTitle(entry.title);
                              setBody(entry.body);
                              setVisibility(entry.visibility);
                              create.reset();
                              setAdding(true);
                            }}
                          >
                            {t("rheoSpaces.knowledge.edit")}
                          </Button>
                        )}
                        {entry.state === "proposed" && entry.kind === "memory" && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={review.isPending}
                            onClick={() => review.mutate({ id: entry.id, state: "approved", revision: entry.revision })}
                          >
                            {t("rheoSpaces.knowledge.approve")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: entry.id, state: "archived", revision: entry.revision })}
                        >
                          {t("rheoSpaces.archive")}
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
                {list.hasNextPage && (
                  <Button
                    size="sm"
                    disabled={list.isFetchingNextPage}
                    loading={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {t("rheoSpaces.knowledge.loadMore")}
                  </Button>
                )}
                {review.isError && (
                  <p role="alert" className="ac-field__error">
                    {errorText(t, review.error)}
                  </p>
                )}
              </div>
            </TabPanel>
            <TabPanel value="sources">
              <div className="rheo-knowledge__stack">
                <p className="small muted">{t("rheoSpaces.knowledge.sourcesHelp")}</p>
                {receipts.length === 0 && <EmptyState icon="search">{t("rheoSpaces.knowledge.noSources")}</EmptyState>}
                {receipts.map((receipt) => (
                  <article className="ac-card rheo-knowledge__receipt" key={receipt.runId}>
                    <h3>
                      {t("rheoSpaces.knowledge.run")} <code>{receipt.runId}</code>
                    </h3>
                    <time className="small muted" dateTime={receipt.createdAt}>
                      {formatFullDate(i18n.language, receipt.createdAt)}
                    </time>
                    <h4>{t("rheoSpaces.knowledge.entryIds")}</h4>
                    <ul>
                      {receipt.entryIds.map((id) => (
                        <li key={id}>
                          <code>{id}</code>
                          {receipt.entryRevisions?.[id] !== undefined && (
                            <> · {t("rheoSpaces.knowledge.revision", { revision: receipt.entryRevisions[id] })}</>
                          )}
                        </li>
                      ))}
                    </ul>
                    {receipt.entryIds.length === 0 && <p className="small muted">{t("rheoSpaces.knowledge.none")}</p>}
                    <h4>{t("rheoSpaces.knowledge.messageIds")}</h4>
                    <ul>
                      {receipt.messageIds.map((id) => (
                        <li key={id}>
                          <code>{id}</code>
                        </li>
                      ))}
                    </ul>
                    {receipt.messageIds.length === 0 && <p className="small muted">{t("rheoSpaces.knowledge.none")}</p>}
                  </article>
                ))}
              </div>
            </TabPanel>
          </Tabs>
        )}
      </DetailsSection>
    </DetailsDialog>
  );
}
