export type BackgroundPlaybackMode = "off" | "rotate";

export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

/**
 * Preserve the existing background behavior: constrained connections keep the
 * smoke, while every video-capable connection rotates the same five clips.
 * Safari does not expose Network Information and therefore keeps its rotation.
 */
export function getBackgroundPlaybackMode(
  connection?: NetworkInformationLike,
): BackgroundPlaybackMode {
  if (!connection) return "rotate";
  if (connection.saveData) return "off";

  const effectiveType = connection.effectiveType?.toLowerCase();
  if (effectiveType && /^(slow-)?2g$|^3g$/.test(effectiveType)) return "off";
  return "rotate";
}

export function getNavigatorConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (
    navigator as Navigator & { connection?: NetworkInformationLike }
  ).connection;
}
