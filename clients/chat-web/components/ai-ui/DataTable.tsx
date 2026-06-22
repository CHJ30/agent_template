"use client";
import type { TableComponent } from "./types";

interface Props {
  component: TableComponent;
}

export function DataTable({ component }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {component.title && (
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">{component.title}</h3>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-gray-50">
              {component.columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className="whitespace-nowrap border-b border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-500"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {component.rows.length === 0 && (
              <tr>
                <td
                  colSpan={component.columns.length}
                  className="px-4 py-6 text-center text-xs text-gray-400"
                >
                  暂无数据
                </td>
              </tr>
            )}
            {component.rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-gray-100 hover:bg-gray-50 ${i % 2 === 1 ? "bg-gray-50/40" : ""}`}
              >
                {component.columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 text-xs text-gray-700">
                    {row[col.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {component.pagination && (
        <div className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
          第 {component.pagination.page} 页 · 每页 {component.pagination.pageSize} 条 · 共{" "}
          {component.pagination.total} 条
        </div>
      )}
    </div>
  );
}
