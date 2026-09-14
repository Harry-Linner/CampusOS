import { z } from "zod";
import type { PluginCapabilityReadInput } from "../shared/pluginBridge";
import type { PluginRuntimeConfigurationInput } from "@campusos/shared";

/**
 * schema 化 IPC 契约（K4，dsh-api-gateway 式）：
 * capability 类 IPC 的载荷统一用 zod schema 校验，fail closed——
 * 未知字段/非法值一律拒绝，不让脏载荷进入业务层。
 */

export const capabilityReadInputSchema = z.strictObject({
  pluginId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/),
  capability: z
    .string()
    .regex(/^[a-z][a-z0-9.-]*@[1-9][0-9]*$/)
});

export const pluginConfigurationInputSchema = z.strictObject({
  pluginId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/),
  enabled: z.boolean(),
  grantedPermissions: z.array(z.string().min(1).max(256))
});

/** 解析成功返回领域类型，失败返回 null（fail closed 由调用方抛错）。 */
export const parseCapabilityReadInput = (
  value: unknown
): PluginCapabilityReadInput | null => {
  const parsed = capabilityReadInputSchema.safeParse(value);
  return parsed.success
    ? (parsed.data as unknown as PluginCapabilityReadInput)
    : null;
};

export const parsePluginConfigurationInput = (
  value: unknown
): PluginRuntimeConfigurationInput | null => {
  const parsed = pluginConfigurationInputSchema.safeParse(value);
  return parsed.success
    ? (parsed.data as unknown as PluginRuntimeConfigurationInput)
    : null;
};

