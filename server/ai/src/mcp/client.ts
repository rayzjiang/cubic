import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolves to server/mcp/build/index.js regardless of cwd
// esbuild bundles everything into build/index.js, so __dirname = server/ai/build
const MCP_SERVER_PATH = path.resolve(__dirname, "../../mcp/build/index.js");

export class McpClient {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const transport = new StdioClientTransport({
        command: "node",
        args: [MCP_SERVER_PATH],
        env: process.env as Record<string, string>,
      });
      const c = new Client({ name: "cubic-ai", version: "0.1.0" }, { capabilities: {} });
      await c.connect(transport);
      this.client = c;
    })();

    await this.connecting;
    this.connecting = null;
  }

  async callRunScript(script: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    await this.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await this.client!.callTool({
      name: "runScript",
      arguments: { script, parameters },
    });

    const textBlock = (result.content as Array<{ type: string; text?: string }>).find(
      (b) => b.type === "text"
    ) as { type: "text"; text: string } | undefined;
    if (!textBlock) throw new Error(`runScript(${script}): no text content in response`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      throw new Error(`runScript(${script}): response is not JSON — ${textBlock.text.slice(0, 200)}`);
    }

    if (result.isError) {
      const p = parsed as Record<string, unknown>;
      throw new Error(`runScript(${script}) error [${p.errorCode ?? "UNKNOWN"}]: ${p.message ?? textBlock.text}`);
    }

    return parsed;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}

export const mcpClient = new McpClient();
