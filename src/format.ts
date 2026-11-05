/** 1536 → "1.5 KB", 12_500_000 → "11.9 MB". */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
  if (bytes < 1024) return `${Math.max(0.1, round(bytes / 1024))} KB`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${round(value)} ${units[unit]}`;
}
