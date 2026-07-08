import { Injectable } from '@nestjs/common';
import type { UIAction, AIUIResponse } from './ui-types.js';

// ─── Stage definitions ────────────────────────────────────────────────────────

export type FlowStage = 'select_type' | 'fill_detail' | 'confirm' | 'result';

interface SessionState {
  stage: FlowStage;
  history: FlowStage[];          // for back navigation
  collectedData: {
    requirementType?: string;
    requirementTypeLabel?: string;
    formData?: Record<string, unknown>;
    reqId?: string;
  };
}

// ─── Shared component builders ────────────────────────────────────────────────

function buildTypeSelection(): AIUIResponse {
  return {
    version: '1.0',
    intent: 'select_type',
    sessionState: 'select_type',
    components: [
      {
        type: 'selection',
        id: 'sel-req-type',
        title: '请选择需求类型',
        description: '选择后将进入对应的填写流程',
        multiple: false,
        options: [
          { value: 'functional',       label: '功能需求',   description: '新增或变更系统功能' },
          { value: 'non_functional',   label: '非功能需求', description: '性能、安全、可用性等约束' },
          { value: 'bug_fix',          label: 'Bug 修复',   description: '已上线功能的缺陷修复' },
          { value: 'tech_improvement', label: '技术改进',   description: '架构优化、技术债偿还' },
        ],
      },
    ],
  };
}

function buildDetailForm(typeLabel: string): AIUIResponse {
  return {
    version: '1.0',
    intent: 'fill_detail',
    sessionState: 'fill_detail',
    components: [
      {
        type: 'form',
        id: 'form-req-detail',
        title: `填写${typeLabel}详情`,
        description: '带 * 为必填项，填写完成后提交进入确认阶段',
        submitLabel: '下一步：确认提交',
        fields: [
          {
            name: 'title',
            label: '需求标题 *',
            fieldType: 'input',
            required: true,
            placeholder: '用一句话描述需求目标（不超过 100 字）',
            maxLength: 100,
          },
          {
            name: 'description',
            label: '需求描述 *',
            fieldType: 'textarea',
            required: true,
            placeholder: '详细描述业务背景、期望行为及验收标准',
            rows: 5,
          },
          {
            name: 'priority',
            label: '优先级 *',
            fieldType: 'select',
            required: true,
            options: [
              { value: 'P0', label: 'P0 – 紧急（24h 内处理）' },
              { value: 'P1', label: 'P1 – 高（本迭代处理）' },
              { value: 'P2', label: 'P2 – 中（下个迭代）' },
              { value: 'P3', label: 'P3 – 低（待排期）' },
            ],
          },
          {
            name: 'deadline',
            label: '期望交付日期',
            fieldType: 'date',
            required: false,
          },
          {
            name: 'stakeholders',
            label: '相关干系人',
            fieldType: 'input',
            required: false,
            placeholder: '如：产品 @张三、后端 @李四（逗号分隔）',
          },
          {
            name: 'references',
            label: '参考文档 / 链接',
            fieldType: 'input',
            required: false,
            placeholder: 'Confluence 链接、Figma 原型地址等',
          },
        ],
      },
    ],
  };
}

function buildConfirm(typeLabel: string, data: Record<string, unknown>): AIUIResponse {
  const title = String(data['title'] ?? '（未填写）');
  const priority = String(data['priority'] ?? '—');
  const deadline = String(data['deadline'] ?? '不限');
  const description = String(data['description'] ?? '');
  const stakeholders = String(data['stakeholders'] ?? '—');

  return {
    version: '1.0',
    intent: 'confirm',
    sessionState: 'confirm',
    components: [
      {
        type: 'card',
        id: 'card-req-preview',
        title: '需求预览',
        badge: typeLabel,
        subtitle: '请核对以下信息，确认无误后提交分析',
        fields: [
          { label: '需求类型', value: typeLabel, highlight: true },
          { label: '标题', value: title, highlight: true },
          { label: '优先级', value: priority, highlight: true },
          { label: '期望交付', value: deadline },
          { label: '干系人', value: stakeholders },
          {
            label: '描述摘要',
            value: description.length > 80 ? description.slice(0, 80) + '…' : description,
          },
        ],
      },
      {
        type: 'confirmation',
        id: 'confirm-submit-analysis',
        title: '确认提交需求分析？',
        summary: `将对「${title}」进行多维度智能分析，包括需求解析、澄清检查、风险识别与报告生成。`,
        details: [
          '分析结果将以结构化报告形式呈现',
          '如需修改可点击「返回修改」',
          '分析完成后可继续追问或导出报告',
        ],
        confirmLabel: '确认，开始分析',
        cancelLabel: '返回修改',
        variant: 'default',
      },
    ],
  };
}

function buildResult(reqId: string, typeLabel: string): AIUIResponse {
  return {
    version: '1.0',
    intent: 'result',
    sessionState: 'result',
    components: [
      {
        type: 'steps',
        id: 'steps-analysis',
        title: `需求分析已完成  |  ${reqId}`,
        currentStep: 4,
        steps: [
          { label: '需求解析',   description: '提取核心功能点与约束条件', status: 'completed' },
          { label: '澄清检查',   description: '评估需求完整性，识别模糊点', status: 'completed' },
          { label: '多维度分析', description: '功能拆解、依赖梳理、工作量估算', status: 'completed' },
          { label: '风险识别',   description: '识别技术风险与业务风险', status: 'completed' },
          { label: '报告生成',   description: '汇总分析结论，生成结构化报告', status: 'completed' },
        ],
      },
      {
        type: 'action_buttons',
        id: 'actions-after-analysis',
        layout: 'horizontal',
        buttons: [
          { id: 'btn-view-report',   label: '查看分析报告',     actionId: 'view_report',      variant: 'primary',    payload: { reqId } },
          { id: 'btn-ask-followup',  label: '追问 / 补充意见',  actionId: 'ask_followup',     variant: 'secondary' },
          { id: 'btn-new-req',       label: '提交新需求',        actionId: 'new_requirement',  variant: 'ghost' },
          { id: 'btn-export',        label: '导出报告',          actionId: 'export_report',    variant: 'ghost' },
        ],
      },
    ],
  };
}

// ─── State machine ────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  functional:       '功能需求',
  non_functional:   '非功能需求',
  bug_fix:          'Bug 修复',
  tech_improvement: '技术改进',
};

@Injectable()
export class UIFlowService {
  private readonly sessions = new Map<string, SessionState>();

  // Called by UIResponseService when the LLM response fails validation.
  // Returns a guaranteed-valid AIUIResponse so the caller never sees a 500.
  fallbackResponse(): AIUIResponse {
    return buildTypeSelection();
  }

  // Optionally called by the chat endpoint to seed the stage when the LLM
  // has already shown a select_type component.
  initSession(sessionId: string, stage: FlowStage = 'select_type'): void {
    this.sessions.set(sessionId, { stage, history: [], collectedData: {} });
  }

  getStage(sessionId: string): FlowStage | undefined {
    return this.sessions.get(sessionId)?.stage;
  }

  // Called by the chat endpoint when the session is already in `result` stage.
  // Routes text input without invoking the LLM so the flow is never reset.
  handleTextInResult(sessionId: string, text: string): AIUIResponse {
    const session = this.sessions.get(sessionId);
    if (!session) return this.fallbackResponse();

    const lower = text.toLowerCase();

    if (lower.includes('报告') || lower.includes('查看') || lower.includes('report')) {
      return {
        version: '1.0',
        intent: 'view_report',
        sessionState: 'result',
        components: [
          {
            type: 'text',
            id: 'txt-report-view',
            content: `分析报告（${session.collectedData.reqId ?? ''}）已生成完毕。如需深度分析或追问，请直接在对话框输入问题；如需提交新需求，点击「提交新需求」按钮。`,
            format: 'markdown',
          },
        ],
      };
    }

    if (lower.includes('新需求') || lower.includes('新的需求') || lower.includes('重新')) {
      this.initSession(sessionId, 'select_type');
      return buildTypeSelection();
    }

    // Default: re-surface the result card so the user can use the action buttons
    const reqId = session.collectedData.reqId ?? 'REQ-UNKNOWN';
    const typeLabel = session.collectedData.requirementTypeLabel ?? '需求';
    return buildResult(reqId, typeLabel);
  }

  handleAction(sessionId: string, action: UIAction): AIUIResponse {
    // Auto-initialize: if no session exists, infer starting stage from action
    if (!this.sessions.has(sessionId)) {
      const inferredStage: FlowStage =
        action.actionType === 'selection'     ? 'select_type' :
        action.actionType === 'form_submit'   ? 'fill_detail'  :
        action.actionType === 'confirmation'  ? 'confirm'      :
        'select_type';
      this.sessions.set(sessionId, { stage: inferredStage, history: [], collectedData: {} });
    }

    const session = this.sessions.get(sessionId)!;

    switch (session.stage) {
      case 'select_type': return this.onSelectType(sessionId, session, action);
      case 'fill_detail': return this.onFillDetail(sessionId, session, action);
      case 'confirm':     return this.onConfirm(sessionId, session, action);
      case 'result':      return this.onResult(sessionId, session, action);
    }
  }

  // ── Stage handlers ──────────────────────────────────────────────────────────

  private onSelectType(sessionId: string, session: SessionState, action: UIAction): AIUIResponse {
    if (action.actionType !== 'selection') return this.wrongAction(session.stage, action.actionType);

    const value = String(action.payload['value'] ?? action.payload['selectedValue'] ?? '');
    const label = TYPE_LABELS[value] ?? value;

    this.advance(sessionId, session, 'fill_detail', {
      requirementType: value,
      requirementTypeLabel: label,
    });

    return buildDetailForm(label);
  }

  private onFillDetail(sessionId: string, session: SessionState, action: UIAction): AIUIResponse {
    if (action.actionType !== 'form_submit') return this.wrongAction(session.stage, action.actionType);

    this.advance(sessionId, session, 'confirm', { formData: action.payload });

    const label = session.collectedData.requirementTypeLabel ?? '需求';
    return buildConfirm(label, action.payload);
  }

  private onConfirm(sessionId: string, session: SessionState, action: UIAction): AIUIResponse {
    if (action.actionType !== 'confirmation') return this.wrongAction(session.stage, action.actionType);

    const confirmed = action.payload['confirmed'] === true || action.payload['confirmed'] === 'true';

    if (!confirmed) {
      // Back to fill_detail — restore previous stage
      const label = session.collectedData.requirementTypeLabel ?? '需求';
      this.back(sessionId, session);
      return buildDetailForm(label);
    }

    // Generate a stable req ID for this session
    const reqId = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100)}`;
    this.advance(sessionId, session, 'result', { reqId });

    return buildResult(reqId, session.collectedData.requirementTypeLabel ?? '需求');
  }

  private onResult(sessionId: string, session: SessionState, action: UIAction): AIUIResponse {
    if (action.actionType !== 'button_click') return this.wrongAction(session.stage, action.actionType);

    const actionId = String(action.payload['actionId'] ?? action.componentId);

    switch (actionId) {
      case 'new_requirement':
        this.initSession(sessionId, 'select_type');
        return buildTypeSelection();

      case 'view_report':
        return {
          version: '1.0',
          intent: 'view_report',
          sessionState: 'result',
          components: [
            {
              type: 'text',
              id: 'txt-report-hint',
              content: `分析报告（${session.collectedData.reqId ?? ''}）已生成，请通过 \`POST /api/conversations/:id/chat\` 继续深度分析或追问。`,
              format: 'markdown',
            },
          ],
        };

      case 'ask_followup':
        return {
          version: '1.0',
          intent: 'ask_followup',
          sessionState: 'result',
          components: [
            {
              type: 'text',
              id: 'txt-followup-hint',
              content: '请直接在对话框中输入您的追问，分析系统将结合当前需求上下文作答。',
              format: 'plain',
            },
          ],
        };

      case 'export_report':
        return {
          version: '1.0',
          intent: 'export_report',
          sessionState: 'result',
          components: [
            {
              type: 'text',
              id: 'txt-export-hint',
              content: '报告导出功能开发中，敬请期待。',
              format: 'plain',
            },
          ],
        };

      default:
        return this.errorResponse(`未知操作 ${actionId}`);
    }
  }

  // ── Session helpers ─────────────────────────────────────────────────────────

  private advance(
    sessionId: string,
    session: SessionState,
    nextStage: FlowStage,
    data: Partial<SessionState['collectedData']>,
  ): void {
    this.sessions.set(sessionId, {
      stage: nextStage,
      history: [...session.history, session.stage],
      collectedData: { ...session.collectedData, ...data },
    });
  }

  private back(sessionId: string, session: SessionState): void {
    const prev = session.history.at(-1) ?? 'select_type';
    this.sessions.set(sessionId, {
      stage: prev,
      history: session.history.slice(0, -1),
      collectedData: session.collectedData,
    });
  }

  private wrongAction(stage: FlowStage, received: string): AIUIResponse {
    return this.errorResponse(`当前阶段「${stage}」不支持操作类型「${received}」`);
  }

  private errorResponse(message: string): AIUIResponse {
    return {
      version: '1.0',
      intent: 'error',
      components: [{ type: 'text', id: 'txt-error', content: message, format: 'plain' }],
    };
  }
}
