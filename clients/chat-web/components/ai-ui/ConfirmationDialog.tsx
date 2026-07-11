"use client";
import { useState } from "react";
import type { ConfirmationComponent, UIAction } from "./types";

interface Props {
  component: ConfirmationComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

const CONFIRM_COLORS: Record<string, string> = {
  default: "bg-blue-600 hover:bg-blue-700",
  warning: "bg-amber-500 hover:bg-amber-600",
  danger:  "bg-red-600 hover:bg-red-700",
};

const BORDER_COLORS: Record<string, string> = {
  default: "border-blue-200 bg-blue-50",
  warning: "border-amber-200 bg-amber-50",
  danger:  "border-red-200 bg-red-50",
};

export function ConfirmationDialog({ component, onAction, disabled = false }: Props) {
  const variant = component.variant ?? "default";
  const [comment, setComment] = useState("");

  function fire(confirmed: boolean) {
    onAction({
      actionType: "confirmation",
      componentId: component.id,
      payload: {
        confirmed,
        comment,
        resumeToken: component.resumeToken,
      },
    });
  }

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${BORDER_COLORS[variant]}`}>
      <h3 className="mb-1 text-sm font-semibold text-gray-800">{component.title}</h3>
      <p className="mb-3 text-sm text-gray-600">{component.summary}</p>

      {component.details && component.details.length > 0 && (
        <ul className="mb-4 space-y-1">
          {component.details.map((d, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
              <span className="mt-0.5 text-gray-400">•</span>
              {d}
            </li>
          ))}
        </ul>
      )}

      {component.inputLabel && (
        <label className="mb-4 block">
          <span className="mb-1.5 block text-xs font-medium text-gray-700">
            {component.inputLabel}
          </span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={component.inputPlaceholder}
            rows={4}
            disabled={disabled}
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
          />
        </label>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fire(true)}
          disabled={disabled}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${CONFIRM_COLORS[variant]}`}
        >
          {component.confirmLabel ?? "确认"}
        </button>
        <button
          type="button"
          onClick={() => fire(false)}
          disabled={disabled}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {component.cancelLabel ?? "取消"}
        </button>
      </div>
    </div>
  );
}
