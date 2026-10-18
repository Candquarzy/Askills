import { invoke, isTauri } from "@tauri-apps/api/core";
export { isTauri };
export function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri())
    return Promise.reject(new Error("请在 Askills 桌面应用中执行本地操作。"));
  return invoke<T>(command, args);
}
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const code = "code" in error ? String(error.code) + " · " : "";
    return code + String(error.message);
  }
  return String(error);
}
export const shortHash = (value: string | null | undefined) =>
  value?.slice(0, 10) || "本地快照";
export function sizeLabel(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
