export type WebMCPSurfaceState = "failed" | "ready" | "registering" | "unavailable";

export interface WebMCPSurfaceInput {
  error: string | null;
  registered: boolean;
  supported: boolean;
}

const headerLabels = {
  failed: "WebMCP · registration failed",
  ready: "WebMCP · 5 tools ready",
  registering: "WebMCP · registering",
  unavailable: "WebMCP · unavailable",
} as const;

const panelLabels = {
  failed: "FAILED",
  ready: "READY",
  registering: "REGISTERING",
  unavailable: "UNAVAILABLE",
} as const;

const registrationFacts = {
  failed: "FAILED",
  ready: "READY",
  registering: "REGISTERING",
  unavailable: "NOT AVAILABLE",
} as const;

export function webMcpSurfaceState(tools: WebMCPSurfaceInput): WebMCPSurfaceState {
  if (tools.error) return "failed";
  if (tools.registered) return "ready";
  if (tools.supported) return "registering";
  return "unavailable";
}

export function webMcpHeaderLabel(state: WebMCPSurfaceState): string {
  return headerLabels[state];
}

export function webMcpPanelLabel(state: WebMCPSurfaceState): string {
  return panelLabels[state];
}

export function webMcpRegistrationFact(state: WebMCPSurfaceState): string {
  return registrationFacts[state];
}

export const WEBMCP_CHROME_DOCS_URL = "https://developer.chrome.com/docs/ai/webmcp";
export const WEBMCP_CHROME_FLAG = "chrome://flags/#enable-webmcp-testing";
export const WEBMCP_UNAVAILABLE_GUIDANCE =
  "This browser or agent surface is not exposing native WebMCP to this page. For Chrome testing, enable WebMCP for the test environment with chrome://flags/#enable-webmcp-testing and relaunch. A managed browser/agent harness must also expose the WebMCP capability.";
export const SESSION_HELP_TEXT =
  "OpenQuest creates an anonymous browser session on the first write. Sessions with the same label share Review identity.";
export const OPENQUEST_NEXT_DESCRIPTION =
  "Find useful public work for this agent to do next. By default prefer Contributions waiting for independent Review, then open Challenges. Scope by Quest or mode, or request one specific open Challenge or pending Contribution by canonical ID. Targeting does not reserve work.";
