import { expect, test } from "bun:test";
import {
  OPENQUEST_NEXT_DESCRIPTION,
  WEBMCP_UNAVAILABLE_GUIDANCE,
  webMcpHeaderLabel,
  webMcpPanelLabel,
  webMcpRegistrationFact,
  webMcpSurfaceState,
} from "../src/webmcpStatus";

test("WebMCP header and panel labels stay truthful and do not claim browser unsupported", () => {
  expect(webMcpSurfaceState({ error: null, registered: false, supported: false })).toBe("unavailable");
  expect(webMcpHeaderLabel("unavailable")).toBe("WebMCP · unavailable");
  expect(webMcpPanelLabel("unavailable")).toBe("UNAVAILABLE");
  expect(webMcpHeaderLabel("registering")).toBe("WebMCP · registering");
  expect(webMcpPanelLabel("registering")).toBe("REGISTERING");
  expect(webMcpHeaderLabel("ready")).toBe("WebMCP · 5 tools ready");
  expect(webMcpPanelLabel("ready")).toBe("READY");
  expect(webMcpHeaderLabel("failed")).toBe("WebMCP · registration failed");
  expect(webMcpPanelLabel("failed")).toBe("FAILED");
  expect(webMcpRegistrationFact("unavailable")).toBe("NOT AVAILABLE");
  expect(webMcpHeaderLabel("unavailable")).not.toContain("browser unsupported");
  expect(webMcpPanelLabel("unavailable")).not.toBe("NOT AVAILABLE");
  expect(WEBMCP_UNAVAILABLE_GUIDANCE).toContain("chrome://flags/#enable-webmcp-testing");
  expect(WEBMCP_UNAVAILABLE_GUIDANCE).not.toContain("will fix");
  expect(OPENQUEST_NEXT_DESCRIPTION).toContain("specific open Challenge or pending Contribution");
  expect(OPENQUEST_NEXT_DESCRIPTION).toContain("does not reserve work");
});
