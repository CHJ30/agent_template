"use client";
import type { StepsComponent } from "./types";

interface Props {
  component: StepsComponent;
}

const STATUS_ICON: Record<string, string> = {
  completed: "✓",
  active:    "●",
  error:     "✗",
  pending:   "○",
};

const STATUS_RING: Record<string, string> = {
  completed: "bg-green-500 text-white",
  active:    "bg-blue-500 text-white ring-2 ring-blue-200",
  error:     "bg-red-500 text-white",
  pending:   "bg-gray-100 text-gray-400 ring-1 ring-gray-200",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "text-green-700",
  active:    "text-blue-700 font-semibold",
  error:     "text-red-700",
  pending:   "text-gray-400",
};

const STATUS_LINE: Record<string, string> = {
  completed: "bg-green-400",
  active:    "bg-blue-200",
  error:     "bg-red-200",
  pending:   "bg-gray-200",
};

export function StepsProgress({ component }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {component.title && (
        <h3 className="mb-3 text-sm font-semibold text-gray-800">{component.title}</h3>
      )}

      <ol className="flex items-start gap-0">
        {component.steps.map((step, i) => {
          const isLast = i === component.steps.length - 1;
          const lineStatus = component.steps[i + 1]?.status ?? "pending";
          return (
            <li key={i} className="flex flex-1 flex-col items-center">
              {/* Icon row */}
              <div className="flex w-full items-center">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${STATUS_RING[step.status]}`}
                >
                  {STATUS_ICON[step.status]}
                </div>
                {!isLast && (
                  <div className={`h-0.5 flex-1 ${STATUS_LINE[lineStatus]}`} />
                )}
              </div>

              {/* Label */}
              <div className="mt-1.5 w-full pr-2 text-center">
                <div className={`text-xs ${STATUS_LABEL[step.status]}`}>{step.label}</div>
                {step.description && (
                  <div className="mt-0.5 text-xs leading-tight text-gray-400">
                    {step.description}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
