import { serve } from "https://deno.land/std/http/server.ts";

const version = Deno.env.get("APP_VERSION") || "unknown";

serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/api/version") {
    return new Response(version, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Handle other routes
  return new Response("Hello, Deno Deploy!");
});