import { describe, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({
  download: vi.fn(async () => ({ contentUri: "content://updates/latest.apk" })),
  openInstaller: vi.fn(async () => {}),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-intent-launcher", () => ({ startActivityAsync: native.openInstaller }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    readonly uri = "file:///cache/latest.apk";
    static downloadFileAsync = native.download;
  },
}));

import { runAndroidReleaseUpdateCheck } from "./android-release-updates";

function release(versionCode: number) {
  return {
    tag_name: `android-preview-${versionCode}`,
    assets: [
      {
        name: "t3-code-preview.apk",
        browser_download_url: `https://example.com/${versionCode}.apk`,
      },
    ],
  };
}

function setup(releases: unknown) {
  vi.clearAllMocks();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(releases));
  const onStateChange = vi.fn();
  const check = () =>
    runAndroidReleaseUpdateCheck({
      repository: "ImbeinBulied/t3code",
      buildVersion: "3",
      onStateChange,
    });
  return { fetch, onStateChange, check };
}

describe("Android release updates", () => {
  it("downloads the newest APK and delegates installation to Android", async () => {
    const { fetch, onStateChange, check } = setup([release(4), release(6), release(5)]);
    try {
      await check();
      expect(native.download).toHaveBeenCalledWith(
        "https://example.com/6.apk",
        expect.anything(),
        expect.anything(),
      );
      expect(native.openInstaller).toHaveBeenCalledWith("android.intent.action.VIEW", {
        data: "content://updates/latest.apk",
        flags: 1,
        type: "application/vnd.android.package-archive",
      });
      expect(onStateChange.mock.calls.map(([state]) => state)).toEqual([
        "checking",
        "downloading",
        "openingInstaller",
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("does not download or downgrade when no newer APK exists", async () => {
    const { fetch, onStateChange, check } = setup([release(2), release(3)]);
    try {
      await check();
      expect(native.download).not.toHaveBeenCalled();
      expect(native.openInstaller).not.toHaveBeenCalled();
      expect(onStateChange).toHaveBeenLastCalledWith("current");
    } finally {
      fetch.mockRestore();
    }
  });

  it("rejects malformed release responses before downloading", async () => {
    const { fetch, check } = setup({ error: "invalid" });
    try {
      await expect(check()).rejects.toThrow("invalid releases list");
      expect(native.download).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
