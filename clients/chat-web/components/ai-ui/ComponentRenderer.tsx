"use client";
import type { UIComponent, UIAction } from "./types";
import { SelectionCard } from "./SelectionCard";
import { DynamicForm } from "./DynamicForm";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { InfoCard } from "./InfoCard";
import { StepsProgress } from "./StepsProgress";
import { DataTable } from "./DataTable";
import { ActionButtons } from "./ActionButtons";

interface Props {
  component: UIComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

function TextDisplay({ content, format }: { content: string; format?: string }) {
  if (format === "markdown") {
    // Minimal markdown: newlines → <br>, **bold**, `code`
    const html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code class='bg-gray-100 px-1 rounded text-xs font-mono'>$1</code>")
      .replace(/\n/g, "<br />");
    return (
      <div
        className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
      {content}
    </div>
  );
}

export function ComponentRenderer({ component, onAction, disabled = false }: Props) {
  switch (component.type) {
    case "text":
      return <TextDisplay content={component.content} format={component.format} />;

    case "selection":
      return <SelectionCard component={component} onAction={onAction} disabled={disabled} />;

    case "form":
      return <DynamicForm component={component} onAction={onAction} disabled={disabled} />;

    case "confirmation":
      return <ConfirmationDialog component={component} onAction={onAction} disabled={disabled} />;

    case "card":
      return <InfoCard component={component} onAction={onAction} disabled={disabled} />;

    case "steps":
      return <StepsProgress component={component} />;

    case "table":
      return <DataTable component={component} />;

    case "action_buttons":
      return <ActionButtons component={component} onAction={onAction} disabled={disabled} />;

    default: {
      // Exhaustiveness guard: if a new type is added to the backend but not here,
      // TypeScript will warn (via the `never` cast below).
      const _exhaustive: never = component;
      return (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          未知组件类型：{(_exhaustive as UIComponent).type}
        </div>
      );
    }
  }
}
