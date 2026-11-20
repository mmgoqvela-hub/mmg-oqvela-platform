import { scheduleSubscriptionNotifications } from "./notifications/scheduler.js";
import { handleAuth } from "./routes/auth.js";
import { handleAdmin } from "./routes/admin.js";
import { handleTrial } from "./routes/trial.js";
import { handleStores } from "./routes/stores.js";
import { handleCatalog } from "./routes/catalog.js";
import { handlePublicStorefront } from "./routes/storefront.js";
import { handleTeam } from "./routes/team.js";
import { handleSubscriptions } from "./routes/subscriptions.js";
import { handleNotifications } from "./routes/notifications.js";
import { handleOrders } from "./routes/orders.js";
import { handlePublicServiceRequests } from "./routes/service_requests.js";

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      scheduleSubscriptionNotifications(env),
      env.DB.prepare("DELETE FROM public_checkout_rate_limits WHERE window_started_at < datetime('now','-2 days')").run()
    ]));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 }
        );
      }

      try {
        const migrations = await env.DB
          .prepare("SELECT COUNT(*) AS total FROM d1_migrations")
          .first();

        const tables = await env.DB
          .prepare(`
            SELECT COUNT(*) AS total
            FROM sqlite_master
            WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          `)
          .first();

        return Response.json({
          status: "ok",
          platform: "MMG OQVELA",
          service: "Multi-Store SaaS Platform",
          version: "1.0.0",
          database: {
            status: "connected",
            migrations: migrations.total,
            tables: tables.total
          }
        }, {
          headers: {
            "Cache-Control": "no-store"
          }
        });

      } catch {
        return Response.json({
          status: "degraded",
          platform: "MMG OQVELA",
          database: { status: "error" }
        }, { status: 503 });
      }
    }

    const storefrontPath = url.pathname.match(/^\/s\/[^/]+\/?$/);
    if (storefrontPath && request.method === "GET") {
      const assetUrl = new URL("/storefront.html", request.url);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), {
        method: "GET",
        headers: request.headers
      }));
    }

    const serviceRequestsResponse = await handlePublicServiceRequests(request, env);
    if (serviceRequestsResponse) return serviceRequestsResponse;

    const ordersResponse = await handleOrders(request, env);
    if (ordersResponse) return ordersResponse;

    const publicStoreResponse = await handlePublicStorefront(request, env);
    if (publicStoreResponse) return publicStoreResponse;

    const notificationsResponse = await handleNotifications(request, env);
    if (notificationsResponse) return notificationsResponse;

    const subscriptionsResponse = await handleSubscriptions(request, env);

    if (subscriptionsResponse) {
      return subscriptionsResponse;
    }

    const teamResponse = await handleTeam(request, env);
    if (teamResponse) return teamResponse;

    const catalogResponse = await handleCatalog(request, env);

    if (catalogResponse) {
      return catalogResponse;
    }

    const storesResponse = await handleStores(request, env);

    if (storesResponse) {
      return storesResponse;
    }

    const trialResponse = await handleTrial(request, env);

    if (trialResponse) {
      return trialResponse;
    }

    const adminResponse = await handleAdmin(request, env);

    if (adminResponse) {
      return adminResponse;
    }

    const authResponse = await handleAuth(request, env);

    if (authResponse) {
      return authResponse;
    }

    return env.ASSETS.fetch(request);
  }
};
