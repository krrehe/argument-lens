/**
 * 版本比较：`version >= floor` 吗？
 *
 * 为什么单独一处：判档（2.8.0 起）与修辞审计（2.9.0 起）都要问同一件事——
 * 「这份报告产自哪一版，那一版有没有这一层」。两处各写一份比较，迟早在某一处
 * 写成 `version === '2.9.0'`，于是 2.10.0 的报告被当成旧档：
 * 界面会说「当时还没有这一层」，而它其实有，只是没人给它渲染。
 *
 * 比较按数字逐段做，不按字符串：字符串比较里 "2.10.0" < "2.9.0"。
 * 解析不出版本号时返回 false（按「没有」处理）——旧档确实没有，新档会带，
 * 而猜一个 true 会让空栏显示成「模型这次没做」。
 */
export function versionAtLeast(version: string | undefined, floor: string): boolean {
  if (!version) return false;
  const a = version.split('.').map((x) => Number.parseInt(x, 10));
  const b = floor.split('.').map((x) => Number.parseInt(x, 10));
  if (a.some((x) => Number.isNaN(x)) || b.some((x) => Number.isNaN(x))) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
