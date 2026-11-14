import { useMe } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Button, Card, CardHeader, Chip } from "@agenteschat/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePageVisible } from "@/hooks/useWindowActive";
import { officialCodexAuthUrl, spaceCodexApi, spaceCodexReady } from "@/lib/space-codex";
import "./spaces-codex.css";

/** Shows metadata only. The person starts login and opens the official authentication page themselves. */
export function SpacesCodexConnection() {
  const { t } = useTranslation();
  const userId = useMe().data?.user.id;
  const client = useQueryClient();
  const visible = usePageVisible();
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [invalidAuth, setInvalidAuth] = useState(false);
  const status = useQuery({
    queryKey: ["spaces-codex", userId],
    queryFn: ({ signal }) => spaceCodexApi.status(signal),
    enabled: Boolean(userId) && visible,
    retry: false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      visible &&
      (authUrl || query.state.data?.connected) &&
      query.state.status !== "error" &&
      query.state.data?.installed &&
      query.state.data.compatible &&
      query.state.data.sandbox !== "blocked" &&
      !spaceCodexReady(query.state.data)
        ? 3000
        : false,
    meta: { quiet: true },
  });
  useEffect(() => {
    if (!visible) void client.cancelQueries({ queryKey: ["spaces-codex", userId], exact: true });
  }, [client, visible, userId]);
  const login = useMutation({
    mutationFn: spaceCodexApi.login,
    meta: { silent: true },
    onSuccess: ({ authUrl: value }) => {
      const safeUrl = officialCodexAuthUrl(value);
      setAuthUrl(safeUrl);
      setInvalidAuth(!safeUrl);
    },
  });
  const data = status.data;
  const state = status.isError
    ? "error"
    : !data
      ? "detecting"
      : !data.installed
        ? "missing"
        : !data.compatible
          ? "incompatible"
          : data.sandbox === "blocked"
            ? "blocked"
            : !data.connected
              ? "available"
              : spaceCodexReady(data)
                ? "ready"
                : "pending";
  const canLogin =
    data?.installed && data.compatible && data.loginAvailable === true && !data.connected && !status.isError;
  return (
    <Card className="spaces-codex" aria-label={t("spacesCodex.title")}>
      <CardHeader mark="codex" title={t("spacesCodex.title")} subtitle={t("spacesCodex.subtitle")} />
      <div role="status" aria-live="polite" className="spaces-codex__status">
        <Chip
          icon={
            state === "ready"
              ? "approve"
              : state === "blocked" || state === "incompatible" || state === "error"
                ? "alert"
                : "info"
          }
          tone={state === "ready" ? "done" : "neutral"}
        >
          {t(`spacesCodex.states.${state}`)}
        </Chip>
        {data?.version && <span className="small muted">{t("spacesCodex.version", { version: data.version })}</span>}
      </div>
      {state === "blocked" && <p className="small muted spaces-codex__message">{t("spacesCodex.blockedHelp")}</p>}
      {data?.installed && data.compatible && data.sandbox === "pending" && (
        <p className="small muted spaces-codex__message">{t("spacesCodex.pendingHelp")}</p>
      )}
      {authUrl && !data?.connected && <p className="small muted spaces-codex__message">{t("spacesCodex.loginHelp")}</p>}
      {status.isError && (
        <p role="alert" className="ac-field__error">
          {errorText(t, status.error)}
        </p>
      )}
      {login.isError && (
        <p role="alert" className="ac-field__error">
          {errorText(t, login.error)}
        </p>
      )}
      {invalidAuth && (
        <p role="alert" className="ac-field__error">
          {t("spacesCodex.invalidAuth")}
        </p>
      )}
      <div className="ac-acts spaces-codex__actions">
        <Button
          size="sm"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
          loading={status.isFetching}
        >
          {t("spacesCodex.refresh")}
        </Button>
        {data?.installed && !data.connected && !authUrl && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setInvalidAuth(false);
              login.mutate();
            }}
            loading={login.isPending}
            disabled={!canLogin || login.isPending}
          >
            {t("spacesCodex.connect")}
          </Button>
        )}
        {authUrl && !data?.connected && (
          <Button size="sm" variant="primary" asChild>
            <a href={authUrl} target="_blank" rel="noopener noreferrer">
              {t("spacesCodex.openAuth")}
            </a>
          </Button>
        )}
      </div>
    </Card>
  );
}
