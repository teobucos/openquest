type WebMCPJsonValue =
  | boolean
  | number
  | string
  | null
  | WebMCPJsonValue[]
  | { [property: string]: WebMCPJsonValue };

interface WebMCPInput {
  [property: string]: WebMCPJsonValue;
}

interface WebMCPToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

interface WebMCPToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: true;
}

interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: import("zod").core.JSONSchema.BaseSchema;
  annotations?: WebMCPToolAnnotations;
  execute: (
    input: WebMCPInput,
    options?: { signal?: AbortSignal },
  ) => Promise<WebMCPToolResult>;
}

interface ModelContext {
  registerTool(tool: WebMCPTool, options?: { signal?: AbortSignal }): Promise<void>;
}

interface Document {
  readonly modelContext?: ModelContext;
}
