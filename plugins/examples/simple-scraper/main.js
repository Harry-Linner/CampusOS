/**
 * simple-scraper — connector 型 headless 插件示例
 *
 * 这段代码在 QuickJS/WASM 沙箱中运行，无 Node、无网络全局。
 * 实际数据抓取由主进程代理执行（通过权限模型白名单域名）。
 * 这里演示的是数据处理逻辑：消费主进程注入的 capabilities，
 * 转换后通过 JSON 边界返回。
 */

/**
 * run(input) 是 QuickJS 沙箱 v1 的入口契约。
 * 必须是同步函数，返回值必须是可序列化 JSON。
 *
 * @param {{ capabilities?: Record<string, unknown> }} input
 * @returns {{ data: unknown[], generatedAt: string }}
 */
export function run(input) {
  const caps = input.capabilities ?? {};
  const scraped = [];

  // 示例：如果上游有 http 抓取结果，则转换格式
  const rawResponses = caps["demo.raw-http@1"] ?? [];
  for (const record of rawResponses) {
    if (record.data) {
      scraped.push({
        sourceId: record.providerId + ":" + String(scraped.length),
        title: "From " + (record.source ?? "unknown"),
        scrapedAt: new Date().toISOString(),
        payload: record.data
      });
    }
  }

  // 空结果也返回有效结构
  return {
    data: scraped,
    generatedAt: new Date().toISOString()
  };
}
