CREATE TABLE "pipeline_test_cases" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "tickets" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_test_cases_pkey" PRIMARY KEY ("id")
);

INSERT INTO "pipeline_test_cases" (
    "id",
    "title",
    "description",
    "input",
    "tickets",
    "enabled",
    "updatedAt"
) VALUES (
    'financial-realtime-market-5-tickets',
    '大型金融前端实时行情联合需求',
    '5 个相互依赖的金融工单，覆盖实时行情接入、前端展示、预警、交易联动与合规审计，用于验证 Plan-and-Execute、Supervisor 多专家调度和 Reflexion。',
    $case$
请对以下 5 个相互关联的金融实时行情工单进行联合需求分析。重点识别共享技术组件、数据链路、实施依赖、性能瓶颈、安全边界、合规要求和整体上线顺序。

FIN-MKT-001 实时行情数据接入网关：接入沪深、港股和外汇多数据源，统一证券代码、交易时段和行情字段；支持 WebSocket 增量推送、断线重连、序列号缺口检测、快照补偿和主备源切换。目标峰值 30 万条行情/秒，端到端接入延迟 P99 小于 50ms。

FIN-MKT-002 金融前端实时行情工作台：面向专业交易员提供自选股、Level-2 十档盘口、逐笔成交、分时图和 K 线；需要消费 FIN-MKT-001 的标准行情流，支持 10 万在线用户和每屏 200 个证券实时刷新，前端更新延迟 P99 小于 200ms，并控制浏览器 CPU、内存和重绘频率。

FIN-MKT-003 实时行情预警与消息中心：基于 FIN-MKT-001 的行情流配置价格突破、涨跌幅、成交量异动和组合风险预警；预警结果需要实时推送到 FIN-MKT-002，并支持短信、邮件和应用内通知。要求同一规则幂等触发、峰值削峰、通知状态追踪和用户级频率限制。

FIN-MKT-004 行情联动交易下单面板：在 FIN-MKT-002 中根据实时买卖盘生成限价参考，支持一键下单、撤单和订单状态回推；依赖 FIN-MKT-001 的最新价格，同时接入账户、持仓和风控服务。必须防止陈旧行情下单、重复提交、越权交易和价格偏离，并满足关键操作二次确认。

FIN-MKT-005 行情审计、回放与合规留痕：统一记录 FIN-MKT-001 的源行情、FIN-MKT-003 的预警决策和 FIN-MKT-004 的下单依据，支持按用户、证券和时间区间回放当时页面行情。要求敏感字段脱敏、操作日志防篡改、分级授权、数据保存期限管理，并满足金融监管审计与问题追溯要求。

请输出跨工单联合分析报告，而不是五份报告的简单拼接，并明确建议的建设顺序。
    $case$,
    $tickets$[
      {"id":"FIN-MKT-001","title":"实时行情数据接入网关","dependsOn":[]},
      {"id":"FIN-MKT-002","title":"金融前端实时行情工作台","dependsOn":["FIN-MKT-001"]},
      {"id":"FIN-MKT-003","title":"实时行情预警与消息中心","dependsOn":["FIN-MKT-001","FIN-MKT-002"]},
      {"id":"FIN-MKT-004","title":"行情联动交易下单面板","dependsOn":["FIN-MKT-001","FIN-MKT-002"]},
      {"id":"FIN-MKT-005","title":"行情审计、回放与合规留痕","dependsOn":["FIN-MKT-001","FIN-MKT-003","FIN-MKT-004"]}
    ]$tickets$::jsonb,
    true,
    CURRENT_TIMESTAMP
);
