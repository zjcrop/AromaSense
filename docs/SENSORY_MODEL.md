# AromaSense 感官数据模型

Product version: `B0.1.a`
Dictionary: `sensory-dictionary/1.1`

## 1. 设计原则

AromaSense 将感官记录至少分为两层，不把“感知强度”和“喜欢/质量高低”混成一个分数：

1. **描述性（descriptive）**：记录感知到了什么，以及感知强度；
2. **情感/质量印象（affective）**：记录杯测者对相关属性质量的主观评价。

这种分层参考当前 SCA Coffee Value Assessment (CVA) 将 descriptive 与 affective assessment 分开的框架。AromaSense 并不是 SCA 官方表单的电子复制品，也不声称项目自定义流程属于 SCA 标准。

## 2. AromaSense 自定义温段工作流

项目把同一支样品拆分为：

- preparation
- aroma
- high_temp
- mid_temp
- low_temp
- final

其中高温、中温、低温的重复感官记录是 AromaSense 为多样品杯测、温度变化追踪和后续趋势分析设计的工作流扩展。

这套温段划分必须在文档、导出和 UI 中与标准来源明确区分，不能标记为“SCA 规定温段”。

## 3. 描述性量表

`B0.1.a` 使用 0–15 的描述性强度范围，默认步长 0.5，用于：

- 干香强度
- 湿香强度
- 酸质强度
- 甜感强度
- 苦味强度
- 口感/质地强度
- 余韵强度

风味词与缺陷属于描述性数据，不进入“质量分”的数学合成。

雷达图目前只表达描述性强度的跨温段平均趋势，量程同样为 0–15。雷达图是趋势可视化，不是综合质量评分。

## 4. 情感/质量印象量表

Final 阶段使用独立的 1–9 情感评价量表，当前字段为：

- 香气质量印象
- 风味 / 余韵质量印象
- 酸质质量印象
- 甜感质量印象
- 口感质量印象

这些字段不得反向覆盖描述性强度，也不得在未定义方法学时自动合成为所谓“总杯测分”。

## 5. 原始数据与派生数据

持久层必须保持以下边界：

- `observations`：用户实际记录的原始感官观察；
- stage/session state：流程状态；
- radar/mean/summary：由原始记录派生，只在计算或展示时生成；
- revision：某个时间点的不可变数据快照。

任何后续统计模型、偏好模型或综合评分，都必须可以追溯到原始 observation，不能覆盖原值。

## 6. 词典版本化

每条 observation 保存 `dictionary_version`。词典新增字段或改变语义/量表时必须升级词典版本；旧记录保持原版本，不做静默重解释。

当前版本：`sensory-dictionary/1.1`。

## 7. 参考来源

方法学参考应优先使用 SCA 官方 CVA 标准/官方说明，包括：

- Coffee Value Assessment 总体框架；
- SCA-103 Coffee Value Assessment — Descriptive Assessment；
- SCA-104 Coffee Value Assessment — Affective Assessment。

具体标准条文、量表解释和版权内容在产品文档中只做必要摘要，不复制受版权保护的完整表单或标准文本。
