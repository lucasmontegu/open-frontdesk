import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { authClient } from "./lib/auth";
import { ActivityPage } from "./pages/Activity";
import { SignInPage, SignUpPage } from "./pages/Auth";
import { BotDetailPage, BotsPage } from "./pages/Bots";
import { ConnectorsPage } from "./pages/Connectors";
import { ContactDetailPage, ContactsPage } from "./pages/Contacts";
import { HomePage } from "./pages/Home";
import { MissionDetailPage, MissionsPage } from "./pages/Missions";
import { PortfolioDetailPage, PortfoliosPage } from "./pages/Portfolios";

const rootRoute = createRootRoute({ component: Outlet });

// Public routes
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});
const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-up",
  component: SignUpPage,
});

// Authenticated shell. The guard also makes sure an organization is active.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppShell,
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) throw redirect({ to: "/sign-in" });
    const active = (data.session as { activeOrganizationId?: string | null }).activeOrganizationId;
    if (!active) {
      const orgs = await authClient.organization.list();
      const first = orgs.data?.[0];
      if (first) await authClient.organization.setActive({ organizationId: first.id });
    }
  },
});

const child = <P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => appRoute, path, component });

const homeRoute = child("/", HomePage);
const contactsRoute = child("/contacts", ContactsPage);
const contactRoute = child("/contacts/$contactId", ContactDetailPage);
const portfoliosRoute = child("/portfolios", PortfoliosPage);
const portfolioRoute = child("/portfolios/$portfolioId", PortfolioDetailPage);
const botsRoute = child("/bots", BotsPage);
const botRoute = child("/bots/$botId", BotDetailPage);
const missionsRoute = child("/missions", MissionsPage);
const missionRoute = child("/missions/$missionId", MissionDetailPage);
const activityRoute = child("/activity", ActivityPage);
const connectorsRoute = child("/connectors", ConnectorsPage);

const routeTree = rootRoute.addChildren([
  signInRoute,
  signUpRoute,
  appRoute.addChildren([
    homeRoute,
    contactsRoute,
    contactRoute,
    portfoliosRoute,
    portfolioRoute,
    botsRoute,
    botRoute,
    missionsRoute,
    missionRoute,
    activityRoute,
    connectorsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
