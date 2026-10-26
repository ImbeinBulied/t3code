import { File, Paths } from "expo-file-system";
import { startActivityAsync } from "expo-intent-launcher";
import { Platform } from "react-native";

const APK_ASSET_NAME = "t3-code-preview.apk";
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const GITHUB_RELEASE_API_VERSION = "2022-11-28";
const ANDROID_GRANT_READ_URI_PERMISSION = 1;

export type AndroidReleaseUpdateState =
  | "idle"
  | "checking"
  | "downloading"
  | "openingInstaller"
  | "current";

interface AndroidReleaseUpdateOptions {
  readonly buildVersion: string | null;
  readonly onProgress?: (percentage: number | null) => void;
  readonly onStateChange?: (state: AndroidReleaseUpdateState) => void;
  readonly repository: string;
}

interface AndroidRelease {
  readonly assetUrl: string;
  readonly versionCode: number;
}

export function canCheckAndroidReleaseUpdates(options: {
  readonly appVariant: string;
  readonly buildVersion: string | null;
  readonly repository: string | undefined;
}): boolean {
  return (
    Platform.OS === "android" &&
    options.appVariant === "preview" &&
    !(typeof __DEV__ !== "undefined" && __DEV__) &&
    parseVersionCode(options.buildVersion) !== null &&
    isValidRepository(options.repository)
  );
}

export async function runAndroidReleaseUpdateCheck(
  options: AndroidReleaseUpdateOptions,
): Promise<void> {
  if (Platform.OS !== "android") throw new Error("APK updates are only available on Android.");
  const installedVersionCode = parseVersionCode(options.buildVersion);
  if (installedVersionCode === null) throw new Error("Could not read this app's Android version.");
  if (!isValidRepository(options.repository)) {
    throw new Error("The GitHub release repository is invalid.");
  }

  const setState = options.onStateChange ?? (() => {});
  setState("checking");

  const release = await findLatestAndroidRelease(options.repository);
  if (!release || release.versionCode <= installedVersionCode) {
    setState("current");
    return;
  }

  setState("downloading");
  const apk = await File.downloadFileAsync(
    release.assetUrl,
    new File(Paths.cache, `t3-code-preview-${release.versionCode}.apk`),
    {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        options.onProgress?.(
          totalBytes > 0 ? Math.min(100, Math.floor((bytesWritten / totalBytes) * 100)) : null,
        );
      },
    },
  );

  setState("openingInstaller");
  await startActivityAsync("android.intent.action.VIEW", {
    data: apk.contentUri,
    flags: ANDROID_GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  });
}

async function findLatestAndroidRelease(repository: string): Promise<AndroidRelease | null> {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_RELEASE_API_VERSION,
    },
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}.`);

  const releases: unknown = await response.json();
  if (!Array.isArray(releases)) throw new Error("GitHub returned an invalid releases list.");

  let latest: AndroidRelease | null = null;
  for (const value of releases) {
    if (!isRecord(value) || typeof value.tag_name !== "string" || !Array.isArray(value.assets)) {
      continue;
    }
    const tagMatch = /^android-preview-(\d+)$/.exec(value.tag_name);
    if (!tagMatch) continue;
    const versionCode = Number(tagMatch[1]);
    if (!Number.isSafeInteger(versionCode) || versionCode < 1) continue;

    const asset = value.assets.find(
      (item) =>
        isRecord(item) &&
        item.name === APK_ASSET_NAME &&
        typeof item.browser_download_url === "string",
    );
    if (!isRecord(asset) || typeof asset.browser_download_url !== "string") continue;
    if (!latest || versionCode > latest.versionCode) {
      latest = { assetUrl: asset.browser_download_url, versionCode };
    }
  }
  return latest;
}

function parseVersionCode(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const versionCode = Number(value);
  return Number.isSafeInteger(versionCode) && versionCode > 0 ? versionCode : null;
}

function isValidRepository(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
