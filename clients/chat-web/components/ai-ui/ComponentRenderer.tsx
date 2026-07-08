"use client";
import type { UIAction, RenderableUIComponent, UIComponent } from "./types";
import { componentToFallbackText, isKnownComponent } from "./protocol";
import { SelectionCard } from "./SelectionCard";
import { DynamicForm } from "./DynamicForm";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { InfoCard } from "./InfoCard";
import { StepsProgress } from "./StepsProgress";
import { DataTable } from "./DataTable";
import { ActionButtons } from "./ActionButtons";

interface Props {
  component: RenderableUIComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

function TextDisplay({ content, format }: { content: string; format?: string }) {
  if (format === "markdown") {
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
  if (!isKnownComponent(component)) {
    const fallback = componentToFallbackText(component);
    return <TextDisplay content={fallback.content} format={fallback.format} />;
  }

  const knownComponent = component as UIComponent;

  switch (knownComponent.type) {
    case "text":
      return <TextDisplay content={knownComponent.content} format={knownComponent.format} />;

    case "selection":
      return <SelectionCard component={knownComponent} onAction={onAction} disabled={disabled} />;

    case "form":
      return <DynamicForm component={knownComponent} onAction={onAction} disabled={disabled} />;

    case "confirmation":
      return <ConfirmationDialog component={knownComponent} onAction={onAction} disabled={disabled} />;

    case "card":
      return <InfoCard component={knownComponent} onAction={onAction} disabled={disabled} />;

    case "steps":
      return <StepsProgress component={knownComponent} />;

    case "table":
      return <DataTable component={knownComponent} />;

    case "action_buttons":
      return <ActionButtons component={knownComponent} onAction={onAction} disabled={disabled} />;

    default:
      return <TextDisplay content={componentToFallbackText(component).content} format="plain" />;
  }
}
