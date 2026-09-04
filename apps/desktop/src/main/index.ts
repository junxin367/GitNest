import { app } from "electron";

import { createApplication } from "./bootstrap/create-application";

void createApplication().catch(() => {
  process.exitCode = 1;
  app.quit();
});
