"use client";
import { useState } from "react";
import type { SelectionComponent, UIAction } from "./types";

interface Props {
  component: SelectionComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

export function SelectionCard({ component, onAction, disabled = false }: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(value: string) {
    if (disabled) return;
    if (!component.multiple) {
      // Single-select: fire immediately
      onAction({ actionType: "selection", componentId: component.id, payload: { value } });
      return;
    }
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function confirmMulti() {
    onAction({ actionType: "selection", componentId: component.id, payload: { value: selected } });
  }

  const cols = component.options.length <= 2 ? "grid-cols-1" : "grid-cols-2";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-gray-800">{component.title}</h3>
      {component.description && (
        <p className="mb-3 text-xs text-gray-500">{component.description}</p>
      )}

      <div className={`grid ${cols} gap-2`}>
        {component.options.map((opt) => {
          const isSelected = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              disabled={disabled}
              className={[
                "rounded-lg border p-3 text-left transition-all",
                "hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300",
                isSelected
                  ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
                  : "border-gray-200 bg-white",
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              ].join(" ")}
            >
              <div className="text-sm font-medium text-gray-800">{opt.label}</div>
              {opt.description && (
                <div className="mt-0.5 text-xs text-gray-500">{opt.description}</div>
              )}
            </button>
          );
        })}
      </div>

      {component.multiple && selected.length > 0 && (
        <button
          onClick={confirmMulti}
          disabled={disabled}
          className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          确认选择（{selected.length} 项）
        </button>
      )}
    </div>
  );
}
