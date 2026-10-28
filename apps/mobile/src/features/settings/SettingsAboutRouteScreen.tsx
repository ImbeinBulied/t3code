import * as Application from "expo-application";
import {
  type AndroidReleaseUpdateState,
  canCheckAndroidReleaseUpdates,
  runAndroidReleaseUpdateCheck,
} from "../updates/android-release-updates";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import Constants from "expo-constants";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useDeadlinePassed } from "../../lib/clock";
import {
  type AppUpdateCheckState,
  isAppUpdateCheckAvailable,
  registerHiddenUpdateTap,
  runAppUpdateCheck,
} from "../updates/app-updates";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

export function SettingsAboutRouteScreen() {
  const insets = useSafeAreaInsets();

  return (
    <SettingsScreen title="About">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <AppSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}

function AppSettingsSection() {
  const [checkState, setCheckState] = useState<{
    readonly state: AppUpdateCheckState;
    // "Up to date" is a confirmation that fades back to idle.
    readonly settledUntil: number | null;
  }>({ state: "idle", settledUntil: null });
  const confirmationExpired = useDeadlinePassed(checkState.settledUntil);
  const updateState =
    checkState.state === "current" && confirmationExpired ? "idle" : checkState.state;
  const [releaseUpdateState, setReleaseUpdateState] = useState<AndroidReleaseUpdateState>("idle");
  const [releaseDownloadProgress, setReleaseDownloadProgress] = useState<number | null>(null);
  const releaseUpdateInFlight = useRef(false);
  const updateInFlight = useRef(false);
  const hiddenUpdateTapCount = useRef(0);

  const version = Constants.expoConfig?.version ?? "0.0.0";
  // Match app.config.ts's production fallback to avoid mislabeling builds as development.
  const variant = (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? "production";
  const variantLabel = variant === "production" ? "" : capitalize(variant);
  const versionLabel = variantLabel ? `${version} · ${variantLabel}` : version;
  const updateCheckAvailable = isAppUpdateCheckAvailable();
  const releaseRepository = Constants.expoConfig?.extra?.mobileUpdateRepository as
    | string
    | undefined;
  const releaseUpdateAvailable = canCheckAndroidReleaseUpdates({
    appVariant: variant,
    buildVersion: Application.nativeBuildVersion,
    repository: releaseRepository,
  });

  const busy =
    updateState === "checking" || updateState === "downloading" || updateState === "restarting";

  const releaseUpdateBusy =
    releaseUpdateState === "checking" ||
    releaseUpdateState === "downloading" ||
    releaseUpdateState === "openingInstaller";

  async function checkForUpdate() {
    // disabled updates next render; the ref blocks same-frame double taps.
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    // Failures arrive through onFailure; the settled result only matters for unlocking.
    await settlePromise(() =>
      runAppUpdateCheck({
        applyMode: "immediate",
        onFailure: (message) => Dialog.alert("Update failed", message),
        onStateChange: (state) =>
          setCheckState({
            state,
            settledUntil: state === "current" ? Date.now() + 3000 : null,
          }),
      }),
    );
    updateInFlight.current = false;
  }

  async function checkForAndroidReleaseUpdate() {
    if (releaseUpdateInFlight.current || !releaseRepository) return;
    releaseUpdateInFlight.current = true;
    setReleaseDownloadProgress(null);
    try {
      await runAndroidReleaseUpdateCheck({
        buildVersion: Application.nativeBuildVersion,
        onProgress: setReleaseDownloadProgress,
        onStateChange: setReleaseUpdateState,
        repository: releaseRepository,
      });
    } catch (error) {
      setReleaseUpdateState("idle");
      Dialog.alert(
        "App update failed",
        error instanceof Error ? error.message : "Could not download or open the Android update.",
      );
    } finally {
      releaseUpdateInFlight.current = false;
      setReleaseUpdateState((state) => (state === "openingInstaller" ? "idle" : state));
    }
  }

  function handleVersionPress() {
    if (!updateCheckAvailable || updateInFlight.current) return;
    const tap = registerHiddenUpdateTap(hiddenUpdateTapCount.current);
    hiddenUpdateTapCount.current = tap.nextCount;
    if (tap.shouldCheck) {
      void checkForUpdate();
    }
  }

  const statusLabel =
    updateState === "checking"
      ? "Checking…"
      : updateState === "downloading"
        ? "Downloading…"
        : updateState === "ready"
          ? "Update ready"
          : updateState === "restarting"
            ? "Restarting…"
            : updateState === "current"
              ? "Up to date"
              : null;

  const releaseStatusLabel =
    releaseUpdateState === "checking"
      ? "Checking GitHub Releases…"
      : releaseUpdateState === "downloading"
        ? releaseDownloadProgress === null
          ? "Downloading APK…"
          : `Downloading APK · ${releaseDownloadProgress}%`
        : releaseUpdateState === "openingInstaller"
          ? "Opening Android installer…"
          : releaseUpdateState === "current"
            ? "Up to date"
            : "Check GitHub Releases";

  const versionRow = (
    <View className="flex-row items-center gap-4 p-4">
      <SymbolView
        name="info.circle"
        size={22}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="regular"
      />
      <Text className="flex-1 text-lg text-foreground">Version</Text>
      <View className="items-end">
        <Text className="text-lg text-foreground-muted">{versionLabel}</Text>
        {statusLabel ? (
          <Text className="text-xs text-foreground-muted/70">{statusLabel}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SettingsSection title="App">
      <SettingsRow icon="internaldrive" label="Client Storage" target="SettingsClientStorage" />
      <SettingsRow icon="stethoscope" label="Diagnostics" target="SettingsDiagnostics" />
      <SettingsRow
        icon="doc.on.doc"
        label="Open source licenses"
        target="SettingsOpenSourceLicenses"
      />
      <SettingsRow icon="doc.text" label="Legal" fullScreenTarget="SettingsLegal" />
      {releaseUpdateAvailable ? (
        <SettingsRow
          icon="arrow.down.circle"
          label="Check for app updates"
          value={releaseStatusLabel}
          disabled={releaseUpdateBusy}
          onPress={() => void checkForAndroidReleaseUpdate()}
        />
      ) : null}

      {updateCheckAvailable ? (
        <Pressable
          accessibilityLabel={`Version ${versionLabel}`}
          accessibilityRole="text"
          disabled={busy}
          onPress={handleVersionPress}
        >
          {versionRow}
        </Pressable>
      ) : (
        versionRow
      )}
    </SettingsSection>
  );
}

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
