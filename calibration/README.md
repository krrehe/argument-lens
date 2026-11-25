# 校准集：先有一把外面的尺子

这套东西只回答一个问题：**软件/模型的判断，和独立人类标注差多少？**

它不测「跑不跑得通」，也不测「报告写得顺不顺」。那些由 `npm run verify` 与 smoke 管。没有这一套，内部再自洽也只是自洽。

## 三个角色

| 角色 | 做什么 | 不许看什么 |
|---|---|---|
| 病例作者 | 选文本、定透镜与模式、列检查问题 | 不看模型输出 |
| 标注者 | 逐题盲标答案与把握程度 | 不看模型输出、不看别人的标 |
| 评分者 | 跑 `calibration:score` | 不改任何标注 |

病例文件只写原文、透镜、模式与**问题**，不写期望答案；期望答案只存在于标注者的 CSV 里。

## 文件

```
calibration/
  schema.json              三类数据的 JSON Schema
  cases/*.json             病例：原文 + 检查问题（status=draft 不计分）
  labels/<代号>.csv        盲标表（一位标注者一份，用代号不写真名）
  labels/template.csv      由病例生成的空白表
  predictions/<来源>.json  软件或基线的预测
```

## 流程

1. 写病例：复制 `cases/` 里的示例，改原文与问题；先保持 `status: "draft"`。
2. 生成盲标表：

   ```bash
   npm run calibration:template
   ```

3. 至少两位标注者独立填写 `labels/<名字>.csv`。题目顺序与病例一致；`verdict` 是档位，其余行是各检查问题。
4. 补完标后把病例改成 `status: "ready"`。
5. 收预测：软件报告或基线模型各写一份 `predictions/<来源>.json`（格式见下）。
6. 评分：

   ```bash
   npm run calibration:score
   npm run calibration:score -- --json
   ```

草稿病例默认不计分；要演练就加 `--include-draft`。

## 标注取值

- `item_id = verdict`：`withstands | weakened | fails | undetermined`
- 其余 `item_id`：`passed | unanswered | violated | na`
- `confidence`：1–5；没有把握就写 2 或 1，不写 5 充数。
- `note`：写理由，尤其是与直觉相反的那一条。

## 预测格式

```json
[
  {
    "case_id": "cal-0001",
    "source": "argument-lens 1.0.0",
    "verdict": "weakened",
    "checks": { "CQ1": "passed", "CQ2": "unanswered", "CQ3": "violated" }
  }
]
```

一份文件可以是一个对象，也可以是数组。`source` 是显示名；同一来源的多份预测放同一个文件。

## 评分怎么读

- **档位准确率**：预测档位与金标一致的比例。
- **检查准确率**：所有检查问题的预测与金标一致的比例。
- **缺失**：预测没给这一题，单独计数；不拿它当答错，也不悄悄跳过。
- **一致性**：标注者之间的原始一致率与平均 Cohen's kappa。低于 0.6 时，先别怪模型——金标本身还没站稳。
- **分歧题**：多数票打平的金标记为「争议」，不计入准确率，但在输出里单列。

不把不同透镜的分数加成一个总分。每副透镜的刻度不同，混在一起算平均，等于把「不可通约」偷偷抹掉。

## 自检

```bash
npm run calibration:check
```

用合成数据验评分器：一致率、kappa、缺失计数、宏平均 F1 都要对得上。改了评分逻辑先跑它。

## 边界

- 金标是人的判断，不是真理；它只代表「这几位标注者独立读出了什么」。
- 样本量小的时候，准确率与 kappa 都不稳；报告数字必须带样本量与标注者数。
- 病例文本要能公开或已获同意；不要把私人聊天、未公开材料放进 `cases/`。
