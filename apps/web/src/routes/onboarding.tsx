import { instanceQuery, meQuery, useMe } from "@agenteschat/client";
import { isPaidReturn } from "@agenteschat/client/lib/billing";
import { settingUp } from "@agenteschat/client/lib/guards";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireUser } from "@/app/guards";
import { useServerLocale } from "@/i18n";
import { ARRIVAL_PARAM } from "@/lib/arrival";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { RheoStartPage } from "@/pages/RheoStartPage";

export const Route = createFileRoute("/onboarding")({
  // Local first access enters Spaces. Preserve the upstream Cloud's billing and setup links.
  validateSearch: (search: Record<string, unknown>): { resume?: string; paid?: true; delete?: 1 } => ({
    ...(typeof search.resume === "string" ? { resume: search.resume } : {}),
    ...(isPaidReturn(search) ? { paid: true } : {}),
    ...(search.delete === undefined ? {} : { delete: 1 as const }),
  }),
  beforeLoad: ({ context, location }) => requireUser(context, location.href),
  loaderDeps: ({ search }) => ({ resume: search.resume, paid: search.paid }),
  loader: async ({ context, deps: { resume, paid } }) => {
    const instance = await context.queryClient.ensureQueryData(instanceQuery(context.api));
    if (!instance.cloud) return { spaces: true };
    if (!resume) return { spaces: false };
    const me = await context.queryClient.fetchQuery(meQuery(context.api)).catch(() => null);
    const org = me?.organizations.find((o) => o.id === resume);
    if (!org || settingUp(org)) return { spaces: false };
    if (paid)
      throw redirect({
        to: "/org/$orgId",
        params: { orgId: resume },
        search: { paid: true as const, [ARRIVAL_PARAM]: 1 } as never,
      });
    throw redirect({ to: "/org/$orgId", params: { orgId: resume } });
  },
  component: function Onboarding() {
    useServerLocale(useMe().data?.user);
    return Route.useLoaderData().spaces ? <RheoStartPage /> : <OnboardingPage />;
  },
});
