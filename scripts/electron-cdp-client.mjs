export class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      socket.addEventListener("open", resolvePromise, {
        once: true
      });
      socket.addEventListener("error", rejectPromise, {
        once: true
      });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.runtimeErrors = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(
              `${message.error.message} (${message.error.code})`
            )
          );
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      if (message.method === "Runtime.exceptionThrown") {
        this.runtimeErrors.push(
          message.params?.exceptionDetails?.text ??
            "Renderer exception"
        );
      }
      if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params?.type === "error"
      ) {
        this.runtimeErrors.push(
          message.params.args
            .map(
              (argument) =>
                argument.value ?? argument.description
            )
            .join(" ")
        );
      }
      if (
        message.method === "Log.entryAdded" &&
        message.params?.entry?.level === "error"
      ) {
        this.runtimeErrors.push(message.params.entry.text);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(
          new Error(`CDP ${method} timed out.`)
        );
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectPromise(error);
        }
      });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params
        })
      );
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text
      );
    }
    return response.result.value;
  }

  async waitFor(label, expression, timeoutMs = 15_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(expression)) {
        return;
      }
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 120)
      );
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  close() {
    this.socket.close();
  }
}
