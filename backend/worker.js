export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        platform: "MMG OQVELA",
        service: "Multi-Store SaaS Platform",
        version: "1.0.0"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
