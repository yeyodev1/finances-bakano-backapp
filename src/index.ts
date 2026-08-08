import { env } from "./config/env";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { seedSuperadmin } from "./services/auth.service";
import { startSchedulers } from "./services/scheduler.service";

const { app, server } = createApp();

async function main() {
  await dbConnect();
  await seedSuperadmin();

  startSchedulers();

  server.timeout = 10 * 60 * 1000;

  server.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
}

// En Vercel cada invocación es serverless: no se abre un listener ni se
// programan crons en proceso (los dispara Vercel contra /api/cron/*).
if (process.env.VERCEL) {
  void dbConnect();
} else {
  main();
}

export default app;
