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

  // Serve TypeScript files with correct MIME type
  if (url.pathname.endsWith('.ts')) {
    try {
      const filePath = `.${url.pathname}`;
      const content = await Deno.readTextFile(filePath);
      return new Response(content, {
        headers: { 
          "Content-Type": "application/javascript",
          "Access-Control-Allow-Origin": "*"
        },
      });
    } catch {
      return new Response("File not found", { status: 404 });
    }
  }

  // Serve static files
  return serveDir(req, {
    fsRoot: ".",
    showDirListing: false,
  });
});