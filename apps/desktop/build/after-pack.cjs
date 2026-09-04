"use strict";

const { rm } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = async function removeStockElectronApp(
  context
) {
  await Promise.all([
    rm(
      join(
        context.appOutDir,
        "resources",
        "default_app.asar"
      ),
      { force: true }
    ),
    rm(join(context.appOutDir, "version"), {
      force: true
    })
  ]);
};
