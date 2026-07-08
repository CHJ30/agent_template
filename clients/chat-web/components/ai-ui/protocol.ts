import type { AIUIResponse, RenderableUIComponent, TextComponent, UIComponent } from "./types";

export const UI_RESPONSE_VERSION = "1.0" as const;

const KNOWN_COMPONENT_TYPES = new Set([
  "text",
  "selection",
  "form",
  "confirmation",
  "card",
  "steps",
  "table",
  "action_buttons",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isKnownComponent(component: RenderableUIComponent): component is UIComponent {
  return KNOWN_COMPONENT_TYPES.has(component.type);
}

export function componentToFallbackText(component: RenderableUIComponent): TextComponent {
  const type = component.type || "unknown";
  const content =
    "content" in component && typeof component.content === "string"
      ? component.content
      : `Unsupported UI component "${type}".\n\n${JSON.stringify(component, null, 2)}`;

  return {
    type: "text",
    id: typeof component.id === "string" ? `fallback-${component.id}` : `fallback-${type}`,
    content,
    format: "plain",
  };
}

export function responseToFallbackText(response: unknown): AIUIResponse {
  return {
    version: UI_RESPONSE_VERSION,
    intent: "fallback_text",
    components: [
      {
        type: "text",
        id: "fallback-response-version",
        content: `Unsupported UI response version.\n\n${JSON.stringify(response, null, 2)}`,
        format: "plain",
      },
    ],
  };
}

export function normalizeAIUIResponse(response: unknown): AIUIResponse {
  if (!isRecord(response) || response.version !== UI_RESPONSE_VERSION) {
    return responseToFallbackText(response);
  }

  const rawComponents = Array.isArray(response.components) ? response.components : [];
  const components = rawComponents.map((component, index): UIComponent => {
    if (!isRecord(component) || typeof component.type !== "string") {
      return {
        type: "text",
        id: `fallback-invalid-${index}`,
        content: `Invalid UI component.\n\n${JSON.stringify(component, null, 2)}`,
        format: "plain",
      };
    }

    const renderable = component as RenderableUIComponent;
    return isKnownComponent(renderable) ? renderable : componentToFallbackText(renderable);
  });

  return {
    version: UI_RESPONSE_VERSION,
    components,
    intent: typeof response.intent === "string" ? response.intent : undefined,
    sessionState: typeof response.sessionState === "string" ? response.sessionState : undefined,
  };
}
