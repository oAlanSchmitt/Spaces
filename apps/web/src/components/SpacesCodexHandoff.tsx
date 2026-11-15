import { useMe } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Locked,
  Textarea,
  useUnsavedInDialog,
} from "@agenteschat/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import { copyText } from "@/lib/context-menu";
import { type RheoHandoffConfig, type RheoProject, rheoHandoffKey, rheoSpacesApi } from "@/lib/rheo-spaces";
import "./spaces-codex-handoff.css";

/** The folder is metadata. Opening this dialog never reads the folder or starts Codex. */
export function SpacesCodexHandoff({ project, onClose }: { project: RheoProject; onClose: () => void }) {
  const userId = useMe().data?.user.id;
  if (!userId) return null;
  return (
    <HandoffSession
      key={`${userId}:${project.id}:${project.state}`}
      userId={userId}
      project={project}
      onClose={onClose}
    />
  );
}

function HandoffSession({ userId, project, onClose }: { userId: string; project: RheoProject; onClose: () => void }) {
  const { t } = useTranslation();
  const archived = project.state === "archived";
  const config = useQuery({
    queryKey: rheoHandoffKey(userId, project.id),
    queryFn: ({ signal }) => rheoSpacesApi.handoff(project.id, signal),
    enabled: !archived,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    meta: { quiet: true },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("rheoSpaces.handoff.open")}
      description={project.name}
      closeLabel={t("common.close")}
      className="spaces-codex-handoff"
    >
      {archived ? (
        <DialogBody>
          <p role="status" className="muted small">
            {t("rheoSpaces.handoff.archived")}
          </p>
        </DialogBody>
      ) : config.isFetching ? (
        <DialogBody>
          <LoadingList avatar={false} />
        </DialogBody>
      ) : config.isError ? (
        <DialogBody>
          <ErrorState error={config.error} onRetry={() => void config.refetch()} />
        </DialogBody>
      ) : config.data ? (
        <HandoffForm projectId={project.id} initial={config.data} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function HandoffForm({
  projectId,
  initial,
  onClose,
}: {
  projectId: string;
  initial: RheoHandoffConfig;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [copying, setCopying] = useState(false);
  const preview = useRef<HTMLTextAreaElement>(null);
  const prepare = useMutation({
    meta: { silent: true },
    gcTime: 0,
    mutationFn: () => rheoSpacesApi.prepareHandoff(projectId, fields),
    onSuccess: ({ folderPath, objective, criteria }) => {
      const config = { folderPath, objective, criteria };
      setFields(config);
      setSaved(config);
      setCopyState("idle");
    },
  });
  useUnsavedInDialog(
    fields.folderPath !== saved.folderPath ||
      fields.objective !== saved.objective ||
      fields.criteria !== saved.criteria ||
      prepare.isPending,
  );
  const edit = (next: RheoHandoffConfig) => {
    setFields(next);
    prepare.reset();
    setCopyState("idle");
  };
  const copy = async () => {
    if (!prepare.data || copying) return;
    const text = prepare.data.briefing;
    let copied = false;
    setCopying(true);
    if (typeof navigator.clipboard?.writeText === "function")
      await copyText(text, () => {
        copied = true;
      });
    setCopyState(copied ? "copied" : "manual");
    setCopying(false);
  };
  return (
    <form
      style={{ display: "contents" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!prepare.isPending && !copying) prepare.mutate();
      }}
    >
      <Locked when={prepare.isPending || copying}>
        <DialogBody>
          <p className="muted small">{t("rheoSpaces.handoff.manualHelp")}</p>
          <Field
            label={t("rheoSpaces.handoff.folder")}
            hint={{
              name: t("common.about", { label: t("rheoSpaces.handoff.folder") }),
              text: t("rheoSpaces.handoff.folderHelp"),
            }}
            example={t("rheoSpaces.handoff.folderExample")}
            labelAside={
              fields.folderPath ? (
                <Button size="sm" variant="link" onClick={() => edit({ ...fields, folderPath: null })}>
                  {t("rheoSpaces.handoff.clearFolder")}
                </Button>
              ) : undefined
            }
          >
            <Input
              value={fields.folderPath ?? ""}
              maxLength={2000}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => edit({ ...fields, folderPath: event.target.value || null })}
            />
          </Field>
          <Field label={t("rheoSpaces.handoff.objective")}>
            <Textarea
              value={fields.objective}
              maxLength={4000}
              rows={3}
              onChange={(event) => edit({ ...fields, objective: event.target.value })}
            />
          </Field>
          <Field label={t("rheoSpaces.handoff.criteria")}>
            <Textarea
              value={fields.criteria}
              maxLength={4000}
              rows={3}
              onChange={(event) => edit({ ...fields, criteria: event.target.value })}
            />
          </Field>
          {prepare.isError && (
            <p role="alert" className="ac-field__error">
              {errorText(t, prepare.error)}
            </p>
          )}
          {prepare.data && (
            <>
              <p
                role={copyState === "manual" ? "alert" : "status"}
                className={copyState === "manual" ? "ac-field__error" : "muted small"}
              >
                {t(
                  copyState === "manual"
                    ? "rheoSpaces.handoff.copyFailed"
                    : copyState === "copied"
                      ? "rheoSpaces.handoff.copied"
                      : "rheoSpaces.handoff.prepared",
                )}
              </p>
              <Field
                label={t("rheoSpaces.handoff.preview")}
                hint={{
                  name: t("common.about", { label: t("rheoSpaces.handoff.preview") }),
                  text: t("rheoSpaces.handoff.previewHelp"),
                }}
              >
                <Textarea
                  ref={preview}
                  className="spaces-codex-handoff__preview"
                  value={prepare.data.briefing}
                  readOnly
                  rows={8}
                />
              </Field>
              {copyState === "manual" && (
                <div>
                  <Button
                    size="sm"
                    onClick={() => {
                      preview.current?.focus();
                      preview.current?.select();
                    }}
                  >
                    {t("rheoSpaces.handoff.select")}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogBody>
      </Locked>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.close")}</Button>
        <Button
          type="submit"
          variant={prepare.data ? "default" : "primary"}
          disabled={prepare.isPending || copying}
          loading={prepare.isPending}
        >
          {t("rheoSpaces.handoff.prepare")}
        </Button>
        {prepare.data && (
          <Button
            variant="primary"
            onClick={() => void copy()}
            loading={copying}
            disabled={copying || prepare.isPending}
          >
            {t("rheoSpaces.handoff.copy")}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
