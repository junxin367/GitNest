import { startCodeAnalysisProcess } from "./code-analysis-process-runtime";

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error(
    "The code analysis entry must run as an Electron utility process."
  );
}

startCodeAnalysisProcess(parentPort, {
  exit: (code) => {
    process.exitCode = code;
    setImmediate(() => process.exit(code));
  }
});
