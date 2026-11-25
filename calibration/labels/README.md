# 盲标表

每位标注者一份 CSV，文件名用代号（例如 `A.csv`），不要写真名。

列固定为：

```
case_id,annotator,item_id,answer,confidence,note
```

- `item_id=verdict` 的行填档位；其余行填对应检查问题的答案。
- 不要看 `predictions/`，也不要在提交前对答案。
- `template.csv` 由 `npm run calibration:template` 生成，不要手改；改了病例就重新生成。
