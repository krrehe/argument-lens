/**
 * 透镜模块的契约。
 *
 * 每个透镜必须提供六样东西，缺一样就不许上线：
 *   worldview   这套理论认为「论证出错」是什么
 *   procedure   判定顺序
 *   rules       该透镜特有的硬约束
 *   scopeGuard  什么情况下必须判为不适用
 *   checksSpec  checks 数组怎么生成、answer 怎么算
 *   lensShape   lens 对象的 JSON 形状
 *
 * 还有一样是可选的：index，该透镜要附的索引材料
 * （型式+CQ 表、十规则表、名录、PTA 特征表）。
 *
 * 六份模块之间不得互相引用。任何一段写进去的话，都必须属于这副透镜，
 * 换到另一副透镜下就会变成错误指引——这是检查提示词质量的第一条标准。
 */
export interface LensFragment {
  worldview: string;
  procedure: string[];
  rules: string[];
  scopeGuard: string[];
  checksSpec: string;
  lensShape: string;
  index?: string;
}
