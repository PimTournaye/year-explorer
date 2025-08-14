import { serve } from "https://deno.land/std/http/server.ts";
import { serveDir } from "https://deno.land/std/http/file_server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  
  // API routes
  if (url.pathname === "/api/version") {
    const version = Deno.env.get("APP_VERSION") || "unknown";
    return new Response(version, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Serve built static files from dist directory
  return serveDir(req, {
    fsRoot: "./dist",
    showDirListing: false,
  });
});