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
  if (format === "anthropic-messages") return JSON.stringify(renderAnthropicMessages(trace));
  if (format === "chatml") return JSON.stringify(renderChatMl(trace));
  if (format === "sharegpt") return JSON.stringify(renderShareGpt(trace));
  if (format === "sft-text") return JSON.stringify(renderSftText(trace));
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

function renderAnthropicMessages(trace: CanonicalTrace): { id: string; system?: string; messages: unknown[]; metadata: unknown } {
  const messages: unknown[] = [];
  const system: string[] = [];

  for (const message of trace.messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = textFromContent(message.content);
      if (text) system.push(text);
    } else if (message.role === "assistant") {
      const content: unknown[] = [];
      const reasoning = textFromContent(message.reasoning);
      if (reasoning) content.push({ type: "thinking", thinking: reasoning });
      const text = textFromContent(message.content);
      if (text) content.push({ type: "text", text });
      for (const call of message.tool_calls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      messages.push({ role: "assistant", content });
    } else if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: textFromContent(message.content),
        }],
      });
    } else {
      messages.push({ role: "user", content: [{ type: "text", text: textFromContent(message.content) }] });
    }
  }

  const out: { id: string; system?: string; messages: unknown[]; metadata: unknown } = {
    id: trace.session_id,
    messages,
    metadata: {
      source: trace.source,
      outcome: trace.outcome,
    },
  };
  if (system.length > 0) out.system = system.join("\n\n");
  return out;
}

function renderChatMl(trace: CanonicalTrace): { id: string; text: string; metadata: unknown } {
  const parts = trace.messages.map((message) => {
    const role = message.role === "developer" ? "system" : message.role;
    if (message.role === "assistant") {
      const body = [
        textFromContent(message.reasoning) ? `<think>\n${textFromContent(message.reasoning)}\n</think>` : "",
        textFromContent(message.content),
        ...(message.tool_calls ?? []).map((call) => `[tool_call ${call.name} ${JSON.stringify(call.arguments)}]`),
      ].filter(Boolean).join("\n");
      return `<|im_start|>${role}\n${body}<|im_end|>`;
    }
    if (message.role === "tool") {
      return `<|im_start|>tool name=${message.name ?? "tool"} id=${message.tool_call_id ?? ""}\n${textFromContent(message.content)}<|im_end|>`;
    }
    return `<|im_start|>${role}\n${textFromContent(message.content)}<|im_end|>`;
  });

  return {
    id: trace.session_id,
    text: parts.join("\n"),
    metadata: { source: trace.source, outcome: trace.outcome },
  };
}

function renderShareGpt(trace: CanonicalTrace): { id: string; conversations: Array<{ from: string; value: string }>; metadata: unknown } {
  const conversations: Array<{ from: string; value: string }> = [];
  for (const message of trace.messages) {
    if (message.role === "system" || message.role === "developer") {
      conversations.push({ from: "system", value: textFromContent(message.content) });
    } else if (message.role === "assistant") {
      const value = [
        textFromContent(message.reasoning) ? `<think>\n${textFromContent(message.reasoning)}\n</think>` : "",
        textFromContent(message.content),
        ...(message.tool_calls ?? []).map((call) => `<tool_call name="${call.name}" id="${call.id}">${JSON.stringify(call.arguments)}</tool_call>`),
      ].filter(Boolean).join("\n");
      conversations.push({ from: "gpt", value });
    } else if (message.role === "tool") {
      conversations.push({ from: "tool", value: textFromContent(message.content) });
    } else {
      conversations.push({ from: "human", value: textFromContent(message.content) });
    }
  }
  return {
    id: trace.session_id,
    conversations,
    metadata: { source: trace.source, outcome: trace.outcome },
  };
}

function renderSftText(trace: CanonicalTrace): { id: string; text: string; metadata: unknown } {
  const text = trace.messages.map((message) => {
    const label = message.role.toUpperCase();
    if (message.role === "assistant") {
      return [
        `${label}:`,
        textFromContent(message.reasoning) ? `<think>\n${textFromContent(message.reasoning)}\n</think>` : "",
        textFromContent(message.content),
        ...(message.tool_calls ?? []).map((call) => `TOOL_CALL ${call.name} ${JSON.stringify(call.arguments)}`),
      ].filter(Boolean).join("\n");
    }
    if (message.role === "tool") return `TOOL ${message.name ?? ""} ${message.tool_call_id ?? ""}:\n${textFromContent(message.content)}`;
    return `${label}:\n${textFromContent(message.content)}`;
  }).join("\n\n");

  return {
    id: trace.session_id,
    text,
    metadata: { source: trace.source, outcome: trace.outcome },
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
