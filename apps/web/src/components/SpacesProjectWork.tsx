import { createRequester, useMe } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Button, Dialog, DialogBody, DialogFooter, Field, Input, Locked } from "@agenteschat/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import type { RheoProject } from "@/lib/rheo-spaces";
import "./spaces-project-work.css";

export interface SpacesWorkState {
  folderPath: string | null;
  revision: string | null;
  configured: boolean;
  status: "unconfigured" | "pending" | "ready" | "blocked";
  message?: string;
}

const request = createRequester();
const workPath = (projectId: string) => `/api/app/spaces/projects/${encodeURIComponent(projectId)}/work`;
type WorkProps = { project: RheoProject; onClose: () => void; onHandoff?: () => void };

/** Opening the dialog reads configuration only. Association is always an explicit JSON write. */
export function SpacesProjectWork(props: WorkProps) {
  const userId = useMe().data?.user.id;
  if (!userId) return null;
  return <WorkSession key={`${userId}:${props.project.id}:${props.project.state}`} userId={userId} {...props} />;
}

function WorkDialog({
  project,
  onClose,
  unsaved = false,
  children,
}: WorkProps & { unsaved?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("rheoSpaces.work.title")}
      description={project.name}
      closeLabel={t("common.close")}
      className="spaces-project-work"
      unsaved={unsaved}
    >
      {children}
    </Dialog>
  );
}

function WorkSession({ userId, ...props }: WorkProps & { userId: string }) {
  const config = useQuery({
    queryKey: ["spaces-project-work", userId, props.project.id],
    queryFn: () => request<SpacesWorkState>(workPath(props.project.id)),
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    meta: { quiet: true },
  });
  if (config.data && !config.isFetching && !config.isError) return <WorkForm {...props} initial={config.data} />;
  return (
    <WorkDialog {...props}>
      <DialogBody>
        {config.isError ? (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} />
        ) : (
          <LoadingList avatar={false} />
        )}
      </DialogBody>
    </WorkDialog>
  );
}

function WorkForm({ project, onClose, onHandoff, initial }: WorkProps & { initial: SpacesWorkState }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(initial);
  const [folder, setFolder] = useState(initial.folderPath ?? "");
  const archived = project.state === "archived";
  const dirty = folder !== (current.folderPath ?? "");
  const apply = (state: SpacesWorkState) => {
    setCurrent(state);
    setFolder(state.folderPath ?? "");
  };
  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      request<SpacesWorkState>(workPath(project.id), {
        method: "PUT",
        json: { folderPath: folder, revision: current.revision },
      }),
    onSuccess: apply,
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      request<SpacesWorkState>(workPath(project.id), {
        method: "DELETE",
        json: { revision: current.revision },
      }),
    onSuccess: apply,
  });
  const refresh = useMutation({
    meta: { silent: true },
    mutationFn: () => request<SpacesWorkState>(workPath(project.id)),
    onSuccess: apply,
  });
  const busy = save.isPending || remove.isPending || refresh.isPending;
  const error = save.error ?? remove.error ?? refresh.error;
  return (
    <WorkDialog project={project} onClose={onClose} unsaved={dirty && !save.isPending}>
      <form
        style={{ display: "contents" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!archived && folder.trim() && !busy) save.mutate();
        }}
      >
        <Locked when={busy}>
          <DialogBody>
            <p className="muted small">{t("rheoSpaces.work.help")}</p>
            <div className="spaces-project-work__status">
              <p role="status">{t(`rheoSpaces.work.states.${current.status}`)}</p>
              {current.message && <p className="muted small">{current.message}</p>}
            </div>
            {save.isPending && <p className="muted small">{t("rheoSpaces.work.verifying")}</p>}
            {archived && <p className="muted small">{t("rheoSpaces.work.archived")}</p>}
            <Field
              label={t("rheoSpaces.work.folder")}
              hint={{
                name: t("common.about", { label: t("rheoSpaces.work.folder") }),
                text: t("rheoSpaces.work.folderHelp"),
              }}
              example={t("rheoSpaces.work.folderExample")}
            >
              <Input
                value={folder}
                maxLength={2000}
                autoComplete="off"
                spellCheck={false}
                readOnly={archived}
                onChange={(event) => {
                  setFolder(event.target.value);
                  save.reset();
                  remove.reset();
                  refresh.reset();
                }}
              />
            </Field>
            {error && (
              <p role="alert" className="ac-field__error">
                {errorText(t, error)}
              </p>
            )}
            <div className="ac-acts spaces-project-work__actions">
              <Button
                size="sm"
                disabled={busy || dirty}
                loading={refresh.isPending}
                onClick={() => {
                  save.reset();
                  remove.reset();
                  refresh.mutate();
                }}
              >
                {t("rheoSpaces.work.refresh")}
              </Button>
              {current.configured && current.revision && (
                <Button
                  size="sm"
                  disabled={busy}
                  loading={remove.isPending}
                  onClick={() => {
                    save.reset();
                    refresh.reset();
                    remove.mutate();
                  }}
                >
                  {t("rheoSpaces.work.remove")}
                </Button>
              )}
              {onHandoff && !archived && (
                <Button size="sm" variant="link" disabled={busy || dirty} onClick={onHandoff}>
                  {t("rheoSpaces.work.handoff")}
                </Button>
              )}
            </div>
          </DialogBody>
        </Locked>
        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
          {!archived && (
            <Button
              type="submit"
              variant="primary"
              disabled={!folder.trim() || busy || (current.status === "ready" && !dirty)}
              loading={save.isPending}
            >
              {t(
                current.configured && !dirty && current.status !== "ready"
                  ? "rheoSpaces.work.retry"
                  : "rheoSpaces.work.associate",
              )}
            </Button>
          )}
        </DialogFooter>
      </form>
    </WorkDialog>
  );
}
