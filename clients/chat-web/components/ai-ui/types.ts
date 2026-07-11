// Frontend mirror of services/chat/src/llm/ui-protocol/ui-types.ts
// Keep in sync with the backend when adding new component types.

export interface TextComponent {
  type: 'text';
  id: string;
  content: string;
  format?: 'plain' | 'markdown';
}

export interface SelectionOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

export interface SelectionComponent {
  type: 'selection';
  id: string;
  title: string;
  description?: string;
  options: SelectionOption[];
  multiple: boolean;
}

export interface FormField {
  name: string;
  label: string;
  fieldType: 'input' | 'select' | 'textarea' | 'date' | 'number';
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  inputType?: string;
  rows?: number;
  min?: number;
  max?: number;
  maxLength?: number;
  minDate?: string;
  maxDate?: string;
  multiple?: boolean;
}

export interface FormComponent {
  type: 'form';
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
  resumeToken?: string;
  interruptKind?: 'clarification';
}

export interface ConfirmationComponent {
  type: 'confirmation';
  id: string;
  title: string;
  summary: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'warning' | 'danger';
  inputLabel?: string;
  inputPlaceholder?: string;
  resumeToken?: string;
  interruptKind?: 'summary_review';
}

export interface CardField {
  label: string;
  value: string;
  highlight?: boolean;
}

export interface CardAction {
  label: string;
  actionId: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface CardComponent {
  type: 'card';
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  fields: CardField[];
  actions?: CardAction[];
}

export interface Step {
  label: string;
  description?: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

export interface StepsComponent {
  type: 'steps';
  id: string;
  title?: string;
  steps: Step[];
  currentStep: number;
}

export interface TableColumn {
  key: string;
  header: string;
  width?: string;
}

export interface TableComponent {
  type: 'table';
  id: string;
  title?: string;
  columns: TableColumn[];
  rows: Array<Record<string, string>>;
  pagination?: { page: number; pageSize: number; total: number };
}

export interface ActionButton {
  id: string;
  label: string;
  actionId: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  payload?: Record<string, unknown>;
}

export interface ActionButtonsComponent {
  type: 'action_buttons';
  id: string;
  buttons: ActionButton[];
  layout?: 'horizontal' | 'vertical';
}

export interface DocumentResultItem {
  chunkId: string;
  documentId: string;
  filename: string;
  snippet: string;
  score: number;
  chunkIndex?: number;
  mimeType?: string;
}

export interface DocumentResultsComponent {
  type: 'document_results';
  id: string;
  title?: string;
  items: DocumentResultItem[];
}

export type UIComponent =
  | TextComponent
  | SelectionComponent
  | FormComponent
  | ConfirmationComponent
  | CardComponent
  | StepsComponent
  | TableComponent
  | ActionButtonsComponent
  | DocumentResultsComponent;

export interface AIUIResponse {
  version: '1.0';
  components: UIComponent[];
  intent?: string;
  sessionState?: string;
}

export interface UnknownUIComponent {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export type RenderableUIComponent = UIComponent | UnknownUIComponent;

export interface UIAction {
  actionType: 'selection' | 'form_submit' | 'confirmation' | 'button_click';
  componentId: string;
  payload: Record<string, unknown>;
}

// ─── SSE streaming envelope ───────────────────────────────────────────────────
// Mirror of services/chat/src/llm/agents/orchestrator.service.ts StreamEnvelope.
// One unified message shape for every event pushed over the SSE channel — the
// frontend dispatches purely on `messageType`.

export type StreamMessageType =
  | 'markdown'
  | 'ui'
  | 'progress'
  | 'agent_start'
  | 'agent_end'
  | 'done'
  | 'error';

export interface StreamEnvelope {
  messageType: StreamMessageType;
  isChunk?: boolean;
  agent?: string;
  label?: string;
  content?: string;
  component?: UnknownUIComponent;
  progress?: number;
  intent?: 'analyze' | 'query' | 'chat';
  status?: 'completed' | 'needs_clarification' | 'awaiting_review' | 'failed';
  reportId?: string;
  usedAgents?: string[];
  error?: string;
}
