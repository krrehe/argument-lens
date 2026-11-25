# 预测

一份来源一个 JSON 文件，文件名即来源名，例如 `argument-lens.json`、`bare-prompt.json`。

格式见 `../README.md`。只收 `case_id / source / verdict / checks`，不收整份报告——报告格式会变，校准集只认这四样。

同一来源在同一病例上只留一条预测；重跑后覆盖，不追加。
