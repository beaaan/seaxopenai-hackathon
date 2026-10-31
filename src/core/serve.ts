import { serve } from "@hono/node-server";
import { config } from "./env";
import { createApp } from "./server";

serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`pwt server on http://localhost:${info.port}`);
});
