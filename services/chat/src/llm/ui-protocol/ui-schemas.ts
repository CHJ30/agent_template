import { z } from 'zod';

// ─── Leaf schemas ─────────────────────────────────────────────────────────────

export const textComponentSchema = z.object({
  type: z.literal('text'),
  id: z.string(),
  content: z.string(),
  format: z.enum(['plain', 'markdown']).optional(),
});

export const selectionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
});

export const selectionComponentSchema = z.object({
  type: z.literal('selection'),
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  options: z.array(selectionOptionSchema),
  multiple: z.boolean(),
});

export const formFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  fieldType: z.enum(['input', 'select', 'textarea', 'date', 'number']),
  required: z.boolean(),
  placeholder: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  inputType: z.string().optional(),
  rows: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  multiple: z.boolean().optional(),
});

export const formComponentSchema = z.object({
  type: z.literal('form'),
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  fields: z.array(formFieldSchema),
  submitLabel: z.string().optional(),
});

export const confirmationComponentSchema = z.object({
  type: z.literal('confirmation'),
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  details: z.array(z.string()).optional(),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  variant: z.enum(['default', 'warning', 'danger']).optional(),
});

export const cardFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  highlight: z.boolean().optional(),
});

export const cardActionSchema = z.object({
  label: z.string(),
  actionId: z.string(),
  variant: z.enum(['primary', 'secondary', 'danger']).optional(),
});

export const cardComponentSchema = z.object({
  type: z.literal('card'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  fields: z.array(cardFieldSchema),
  actions: z.array(cardActionSchema).optional(),
});

export const stepSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  status: z.enum(['pending', 'active', 'completed', 'error']),
});

export const stepsComponentSchema = z.object({
  type: z.literal('steps'),
  id: z.string(),
  title: z.string().optional(),
  steps: z.array(stepSchema),
  currentStep: z.number(),
});

export const tableColumnSchema = z.object({
  key: z.string(),
  header: z.string(),
  width: z.string().optional(),
});

export const tableComponentSchema = z.object({
  type: z.literal('table'),
  id: z.string(),
  title: z.string().optional(),
  columns: z.array(tableColumnSchema),
  rows: z.array(z.record(z.string(), z.string())),
  pagination: z
    .object({ page: z.number(), pageSize: z.number(), total: z.number() })
    .optional(),
});

export const actionButtonSchema = z.object({
  id: z.string(),
  label: z.string(),
  actionId: z.string(),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).optional(),
});

export const actionButtonsComponentSchema = z.object({
  type: z.literal('action_buttons'),
  id: z.string(),
  buttons: z.array(actionButtonSchema),
  layout: z.enum(['horizontal', 'vertical']).optional(),
});

// ─── Discriminated union ──────────────────────────────────────────────────────

export const uiResponseSchema = z.discriminatedUnion('type', [
  textComponentSchema,
  selectionComponentSchema,
  formComponentSchema,
  confirmationComponentSchema,
  cardComponentSchema,
  stepsComponentSchema,
  tableComponentSchema,
  actionButtonsComponentSchema,
]);

// ─── Full AI response (used with withStructuredOutput) ────────────────────────

export const aiUIResponseSchema = z.object({
  components: z.array(uiResponseSchema),
  intent: z.string().optional(),
  sessionState: z.string().optional(),
});

// ─── User action schema (for request validation) ──────────────────────────────

export const uiActionSchema = z.object({
  actionType: z.enum(['selection', 'form_submit', 'confirmation', 'button_click']),
  componentId: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export type AIUIResponseSchema = z.infer<typeof aiUIResponseSchema>;
export type UIActionSchema = z.infer<typeof uiActionSchema>;
