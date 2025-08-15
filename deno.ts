import { serve } from "https://deno.land/std/http/server.ts";
import { serveDir } from "https://deno.land/std/http/file_server.ts";

serve(async (req) => {
  const url = new URL(req.url);
  
  // API route for version checking
  if (url.pathname === "/api/version") {
    const version = Deno.env.get("APP_VERSION") || Date.now().toString();
    return new Response(version, {
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Serve everything from dist folder
  return serveDir(req, {
    fsRoot: "./dist",
    urlRoot: "",
    showDirListing: false,
  });
});