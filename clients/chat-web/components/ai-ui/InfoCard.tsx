"use client";
import type { CardComponent, UIAction } from "./types";

interface Props {
  component: CardComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

const ACTION_COLORS: Record<string, string> = {
  primary:   "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  danger:    "bg-red-600 text-white hover:bg-red-700",
};

export function InfoCard({ component, onAction, disabled = false }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">{component.title}</h3>
          {component.subtitle && (
            <p className="mt-0.5 text-xs text-gray-500">{component.subtitle}</p>
          )}
        </div>
        {component.badge && (
          <span className="ml-2 shrink-0 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            {component.badge}
          </span>
        )}
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-px bg-gray-100 p-px">
        {component.fields.map((field, i) => (
          <div
            key={i}
            className={`px-4 py-2.5 ${field.highlight ? "bg-blue-50" : "bg-white"}`}
          >
            <dt className="text-xs text-gray-400">{field.label}</dt>
            <dd className={`mt-0.5 text-sm font-medium ${field.highlight ? "text-blue-700" : "text-gray-800"}`}>
              {field.value || "—"}
            </dd>
          </div>
        ))}
      </div>

      {/* Actions */}
      {component.actions && component.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3">
          {component.actions.map((action) => (
            <button
              key={action.actionId}
              onClick={() =>
                onAction({
                  actionType: "button_click",
                  componentId: component.id,
                  payload: { actionId: action.actionId },
                })
              }
              disabled={disabled}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${ACTION_COLORS[action.variant ?? "secondary"]}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
