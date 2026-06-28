import fs from "node:fs";
import path from "node:path";
import type { CanonicalMessage, CanonicalTrace, RenderOptions } from "./types.ts";
import { readCanonicalJsonl, textFromContent } from "./canonical.ts";

export async function runRender(options: RenderOptions): Promise<void> {
  const traces = await readCanonicalJsonl(options.input);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  const lines = traces.map((trace) => renderTrace(trace, options.format));
  fs.writeFileSync(options.output, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  console.log(`Rendered ${traces.length} trace(s) to ${options.output}`);
  console.log(`Format: ${options.format}`);
}

function renderTrace(trace: CanonicalTrace, format: RenderOptions["format"]): string {
  if (format === "openai-chat") return JSON.stringify(renderOpenAIChat(trace));
  if (format === "ornith-qwen-xml") return JSON.stringify(renderOrnithQwenXml(trace));
  throw new Error(`Unsupported render format: ${format}`);
}

function renderOpenAIChat(trace: CanonicalTrace): { id: string; messages: unknown[]; metadata: unknown } {
  const messages: unknown[] = [];

  for (const message of trace.messages) {
    if (message.role === "developer") {
      messages.push({ role: "system", content: textFromContent(message.content) });
    } else if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        name: message.name,
        content: textFromContent(message.content),
      });
    } else if (message.role === "assistant") {
      const assistant: Record<string, unknown> = {
        role: "assistant",
        content: textFromContent(message.content),
      };
      const reasoning = textFromContent(message.reasoning);
      if (reasoning) assistant.reasoning_content = reasoning;
      if (message.tool_calls) {
        assistant.tool_calls = message.tool_calls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }));
      }
      messages.push(assistant);
    } else {
      messages.push({ role: message.role, content: textFromContent(message.content) });
    }
  }

  return {
    id: trace.session_id,
    messages,
    metadata: {
      source: trace.source,
      outcome: trace.outcome,
    },
  };
}

function renderOrnithQwenXml(trace: CanonicalTrace): { id: string; text: string; metadata: unknown } {
  const parts: string[] = [];

  for (const message of trace.messages) {
    if (message.role === "developer") {
      parts.push(`<|im_start|>system\n${textFromContent(message.content)}<|im_end|>`);
    } else if (message.role === "system" || message.role === "user") {
      parts.push(`<|im_start|>${message.role}\n${textFromContent(message.content)}<|im_end|>`);
    } else if (message.role === "assistant") {
      parts.push(renderOrnithAssistant(message));
    } else if (message.role === "tool") {
      parts.push(`<|im_start|>user\n<tool_response>\n${textFromContent(message.content)}\n</tool_response><|im_end|>`);
    }
  }

  return {
    id: trace.session_id,
    text: parts.join("\n"),
    metadata: {
      source: trace.source,
      outcome: trace.outcome,
    },
  };
}

function renderOrnithAssistant(message: CanonicalMessage): string {
  const reasoning = textFromContent(message.reasoning);
  const content = textFromContent(message.content);
  const calls = (message.tool_calls ?? []).map((call) => {
    const params = Object.entries(call.arguments)
      .map(([key, value]) => `<parameter=${key}>\n${typeof value === "string" ? value : JSON.stringify(value)}\n</parameter>`)
      .join("\n");
    return `<tool_call>\n<function=${call.name}>\n${params}\n</function>\n</tool_call>`;
  });

  const body = [
    "<think>",
    reasoning,
    "</think>",
    "",
    content,
    ...calls,
  ].filter((part) => part !== undefined).join("\n").trimEnd();

  return `<|im_start|>assistant\n${body}<|im_end|>`;
}

