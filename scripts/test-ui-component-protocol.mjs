import assert from "node:assert/strict";

const UI_RESPONSE_VERSION = "1.0";
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

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function componentToFallbackText(component) {
  const type = component.type || "unknown";
  const content =
    typeof component.content === "string"
      ? component.content
      : `Unsupported UI component "${type}".\n\n${JSON.stringify(component, null, 2)}`;

  return {
    type: "text",
    id: typeof component.id === "string" ? `fallback-${component.id}` : `fallback-${type}`,
    content,
    format: "plain",
  };
}

function normalizeAIUIResponse(response) {
  if (!isRecord(response) || response.version !== UI_RESPONSE_VERSION) {
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

  const rawComponents = Array.isArray(response.components) ? response.components : [];
  const components = rawComponents.map((component, index) => {
    if (!isRecord(component) || typeof component.type !== "string") {
      return {
        type: "text",
        id: `fallback-invalid-${index}`,
        content: `Invalid UI component.\n\n${JSON.stringify(component, null, 2)}`,
        format: "plain",
      };
    }

    return KNOWN_COMPONENT_TYPES.has(component.type)
      ? component
      : componentToFallbackText(component);
  });

  return {
    version: UI_RESPONSE_VERSION,
    components,
    intent: typeof response.intent === "string" ? response.intent : undefined,
    sessionState: typeof response.sessionState === "string" ? response.sessionState : undefined,
  };
}

const v1 = normalizeAIUIResponse({
  version: "1.0",
  components: [{ type: "text", id: "txt-ok", content: "ok" }],
});
assert.equal(v1.version, "1.0");
assert.equal(v1.components[0].type, "text");
assert.equal(v1.components[0].content, "ok");

const unknownComponent = normalizeAIUIResponse({
  version: "1.0",
  components: [{ type: "timeline", id: "future", items: ["draft", "done"] }],
});
assert.equal(unknownComponent.version, "1.0");
assert.equal(unknownComponent.components.length, 1);
assert.equal(unknownComponent.components[0].type, "text");
assert.equal(unknownComponent.components[0].id, "fallback-future");
assert.match(unknownComponent.components[0].content, /Unsupported UI component "timeline"/);

const unknownVersion = normalizeAIUIResponse({
  version: "2.0",
  components: [{ type: "chart", id: "future-chart" }],
});
assert.equal(unknownVersion.version, "1.0");
assert.equal(unknownVersion.intent, "fallback_text");
assert.equal(unknownVersion.components.length, 1);
assert.equal(unknownVersion.components[0].type, "text");
assert.match(unknownVersion.components[0].content, /Unsupported UI response version/);

console.log("UI component protocol fallback tests passed.");
