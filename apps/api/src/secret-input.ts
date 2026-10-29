export async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let text = "";
    for await (const chunk of process.stdin) {
      text += chunk.toString();
      if (text.length > 256) throw new Error("Password input too long");
    }
    return text.replace(/\r?\n$/, "");
  }
  process.stdout.write("Contraseña (mínimo 12 caracteres): ");
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && value.length < 128) value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
