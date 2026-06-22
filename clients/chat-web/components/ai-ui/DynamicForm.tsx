"use client";
import { useState } from "react";
import type { FormComponent, FormField, UIAction } from "./types";

interface Props {
  component: FormComponent;
  onAction: (action: UIAction) => void;
  disabled?: boolean;
}

const inputBase =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:opacity-60";

function FieldInput({ field, value, onChange, disabled }: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  switch (field.fieldType) {
    case "textarea":
      return (
        <textarea
          id={field.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          rows={field.rows ?? 3}
          maxLength={field.maxLength}
          disabled={disabled}
          className={`${inputBase} resize-y`}
        />
      );

    case "select":
      return (
        <select
          id={field.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          disabled={disabled}
          multiple={field.multiple}
          className={inputBase}
        >
          <option value="">请选择…</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "date":
      return (
        <input
          type="date"
          id={field.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          min={field.minDate}
          max={field.maxDate}
          disabled={disabled}
          className={inputBase}
        />
      );

    case "number":
      return (
        <input
          type="number"
          id={field.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          disabled={disabled}
          className={inputBase}
        />
      );

    default: // 'input'
      return (
        <input
          type={field.inputType ?? "text"}
          id={field.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          disabled={disabled}
          className={inputBase}
        />
      );
  }
}

export function DynamicForm({ component, onAction, disabled = false }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(component.fields.map((f) => [f.name, ""])),
  );

  function set(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onAction({ actionType: "form_submit", componentId: component.id, payload: values });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-gray-800">{component.title}</h3>
      {component.description && (
        <p className="mb-3 text-xs text-gray-500">{component.description}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {component.fields.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="mb-1 block text-xs font-medium text-gray-700">
              {field.label}
              {field.required && <span className="ml-0.5 text-red-500">*</span>}
            </label>
            <FieldInput
              field={field}
              value={values[field.name] ?? ""}
              onChange={(v) => set(field.name, v)}
              disabled={disabled}
            />
          </div>
        ))}

        <button
          type="submit"
          disabled={disabled}
          className="mt-1 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {component.submitLabel ?? "提交"}
        </button>
      </form>
    </div>
  );
}
