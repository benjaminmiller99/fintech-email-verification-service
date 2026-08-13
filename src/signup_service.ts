import { createServer } from "node:http";
import { signupRequest, decideSignupNotification } from "./verification_policy.js";

const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/signup/verify-email") {
    response.writeHead(404).end();
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = signupRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_signup_request", issues: parsed.error.issues }));
      return;
    }

    const audit = await decideSignupNotification(parsed.data);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(audit));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "request_failed" }));
  }
}).listen(port, () => console.log(`Signup service listening on http://localhost:${port}`));
