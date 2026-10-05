import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { authClient } from "./lib/auth";
import { ActivityPage } from "./pages/Activity";
import { BotDetailPage, BotsPage } from "./pages/Bots";
import { ContactDetailPage, ContactsPage } from "./pages/Contacts";
import { HomePage } from "./pages/Home";
import { MissionDetailPage, MissionsPage } from "./pages/Missions";
import { PortfolioDetailPage, PortfoliosPage } from "./pages/Portfolios";
import { SignInPage, SignUpPage } from "./pages/Auth";

const rootRoute = createRootRoute({ component: Outlet });

// Public routes
const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: "/ingresar", component: SignInPage });
const signUpRoute = createRoute({ getParentRoute: () => rootRoute, path: "/registro", component: SignUpPage });

// Authenticated shell. The guard also makes sure an organization is active.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: Layout,
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) throw redirect({ to: "/ingresar" });
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
const contactsRoute = child("/contactos", ContactsPage);
const contactRoute = child("/contactos/$contactId", ContactDetailPage);
const portfoliosRoute = child("/carteras", PortfoliosPage);
const portfolioRoute = child("/carteras/$portfolioId", PortfolioDetailPage);
const botsRoute = child("/bots", BotsPage);
const botRoute = child("/bots/$botId", BotDetailPage);
const missionsRoute = child("/misiones", MissionsPage);
const missionRoute = child("/misiones/$missionId", MissionDetailPage);
const activityRoute = child("/actividad", ActivityPage);

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
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
