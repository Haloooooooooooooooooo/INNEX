# 第二版优化 Benchmark 结果记录表

## 使用说明
这份文档用于记录 benchmark 的实际运行结果，建议配合以下文档一起使用：

- [第二版优化-benchmark-v0.md](/e:/my_vibecoding/INNEX/docs/第二版优化-benchmark-v0.md)
- [第二版优化-过程记录.md](/e:/my_vibecoding/INNEX/docs/第二版优化-过程记录.md)

记录原则：
1. 每条样本至少记录录入解析结果。
2. 如果做了内化，继续补充内化结果。
3. 如果后面做了图谱或 QA，再继续补充。
4. 统一使用三档结论：`通过` / `部分通过` / `失败`。

---

## 状态判断建议

### 录入解析
- `通过`
  - 类型识别正确
  - 原文保留基本完整
  - summary 可用
  - tags 基本合理
- `部分通过`
  - 主流程成功
  - 但 summary/tags/原文质量一般
  - 或 deferred 行为合理但结果还不完整
- `失败`
  - 类型识别错误
  - 原文缺失严重
  - summary/tags 明显不可用
  - 主流程失败

### 内化
- `通过`
  - 忠于原文
  - 结构清晰
  - 正式摘要/标签/概念可用
- `部分通过`
  - 能看但不够稳
  - 有轻微失真或组织一般
- `失败`
  - 丢关键信息
  - 推断污染事实
  - 结构明显失控

### 图谱
- `通过`
  - 建边合理
  - 类型大体正确
  - 证据/置信度说得通
- `部分通过`
  - 有关联但偏弱
  - 关系类型不够准
- `失败`
  - 误连严重
  - 漏连严重

### QA
- `通过`
  - 回答正确
  - 依据合理
  - 边界表达合适
- `部分通过`
  - 基本正确
  - 但证据、表达或扩图策略一般
- `失败`
  - 答错
  - 乱答
  - 没有合理回到原文

---

## 失败原因分类建议
- `type_detect_wrong`
- `url_parse_empty`
- `summary_too_long`
- `summary_too_weak`
- `summary_markdown_polluted`
- `tags_too_generic`
- `tags_structure_polluted`
- `ocr_missing`
- `ocr_garbled`
- `pdf_extract_failed`
- `doc_extract_noisy`
- `deferred_not_triggered`
- `deferred_not_completed`
- `internalize_lost_facts`
- `internalize_over_inferred`
- `graph_missing_relation`
- `graph_wrong_relation`
- `qa_wrong_answer`
- `qa_missing_evidence`
- `qa_followup_misjudged`

---

## 结果总表

| ID | 样本名/类型 | 录入解析 | 内化 | 图谱 | QA | 当前主要问题 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | 小红书链接 01 | 通过 | 通过 | 待测 | 待测 |  | 内化结构完整（核心内容/关键概念/事实/推断/可关联方向齐全），事实与推断分层清晰；parse_debug 核心信号正常：url_platform=xiaohongshu；url_image_count=4；inline_image_ocr_count=4；xhs_image_ocr_succeeded:4；xhs_external_crawler_used:4 |
| S02 | Prompt A/B Test 文字 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），结构完整 |
| S03 | Prompt A/B Test 图片 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），结构完整 |
| S04 | Prompt 输出规范 图片 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），结构完整 |
| S05 | AI 产品经理 PRD 模板 PDF | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），deferred 后可产出草稿 |
| S06 | 公众号链接 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S07 | 小红书链接 02 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S08 | AI 意图识别评估 文字 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S09 | 小红书链接 03 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S10 | 技术栈 MD 文档 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S11 | Java REST API 教案 DOCX | 通过 | 部分通过 | 待测 | 待测 | concepts 缺失 | 内化生成成功（status=success, generation_error=null），但 `concepts=[]` |

---

## 统一优化待办（全样本测完后执行）

- Phase3 汇总：
  - 内化样本成功率：9/10 通过，1/10 部分通过，0 失败（基于 `phase3测试结果.txt` 中 S02-S11）。
  - 主要剩余问题：S11 的结构化概念抽取为空（`concepts=[]`），建议补概念回填与最小数量兜底（如 <3 时触发二次抽取）。

- S06（公众号链接）：
  - 问题：`url_body` 噪音偏多，且当前存在 `4000` 字截断。
  - 影响：原文纯净度与后续内化质量。
  - 处理时机：等本轮 benchmark 全样本录入测完后，统一做 URL 正文清洗与分段策略优化。

---

## 单条记录模板

```md
## SXX 样本名
- 类型：
- 录入时间：
- 当前版本：

### 录入解析
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：
- 结果样例：

### 内化
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：

### 图谱
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：

### QA
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：

### 后续动作
- 
```

---

## 建议记录节奏

### 第一轮
建议先只填：
- `录入解析`
- `当前主要问题`

### 第二轮
录入层稳定后，再补：
- `内化`

### 第三轮
图谱和 QA 能力开始升级后，再逐步补：
- `图谱`
- `QA`

---

## 和过程记录的联动方式
建议规则：
1. benchmark 结果表记录“现象”。
2. 过程记录文档记录“为什么、怎么修、修了什么”。

例如：
- 结果表里写：`S10 summary_markdown_polluted`
- 过程记录里写：`已新增 markdown 清洗和 summary 归一化`

这样后续复盘会非常清晰。

