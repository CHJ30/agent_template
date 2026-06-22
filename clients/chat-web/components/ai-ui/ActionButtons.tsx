"use client";
import type { ActionButtonsComponent, UIAction } from "./types";

interface Props {
  component: ActionButtonsComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

const VARIANT_CLASSES: Record<string, string> = {
  primary:   "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  danger:    "bg-red-600 text-white hover:bg-red-700",
  ghost:     "bg-transparent text-gray-600 hover:bg-gray-100",
};

export function ActionButtons({ component, onAction, disabled = false }: Props) {
  const layout = component.layout ?? "horizontal";

  return (
    <div
      className={[
        "flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm",
        layout === "vertical" ? "flex-col" : "flex-row",
      ].join(" ")}
    >
      {component.buttons.map((btn) => (
        <button
          key={btn.id}
          onClick={() =>
            onAction({
              actionType: "button_click",
              componentId: component.id,
              payload: { actionId: btn.actionId, ...(btn.payload ?? {}) },
            })
          }
          disabled={disabled}
          className={[
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-300",
            VARIANT_CLASSES[btn.variant ?? "secondary"],
          ].join(" ")}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}
