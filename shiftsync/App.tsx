import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Poppins_400Regular } from "@expo-google-fonts/poppins/400Regular";
import { Poppins_500Medium } from "@expo-google-fonts/poppins/500Medium";
import { Poppins_600SemiBold } from "@expo-google-fonts/poppins/600SemiBold";
import { Poppins_700Bold } from "@expo-google-fonts/poppins/700Bold";
import { AppProvider, useApp } from "./src/store/AppStore";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { ThemeProvider, palette, useTheme } from "./src/theme";
import {
  Brand,
  Button,
  Empty,
  Label,
  Logo,
  Screen,
  Skeleton,
} from "./src/components/ui";
import { DialogHost } from "./src/components/dialog";
import { useNotifications } from "./src/store/useNotifications";

function Splash() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.ivory,
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        gap: 20,
      }}
    >
      <Logo size={96} />
      <Text style={{ fontSize: 30, fontWeight: "700", color: palette.navy }}>
        ShiftSync
      </Text>
      <Text style={{ color: palette.navy, fontSize: 16, textAlign: "center" }}>
        Your schedule,{`\n`}perfectly in sync.
      </Text>
      <ActivityIndicator
        color={palette.navy}
        style={{ marginTop: 16 }}
        accessibilityLabel="Loading ShiftSync"
      />
      <StatusBar style="dark" />
    </View>
  );
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <ThemeProvider appearance="Light">
        <Screen>
          <Brand />
          <Empty
            title="Something went wrong."
            description="We couldn't show your schedule. Please try again."
            action="Try Again"
            onPress={() => this.setState({ failed: false })}
          />
        </Screen>
      </ThemeProvider>
    ) : (
      this.props.children
    );
  }
}
function AppContent() {
  const { data, loading, loadError, retryLoad } = useApp();
  return (
    <ThemeProvider appearance={data.preferences.appearance}>
      {loading ? (
        <Screen>
          <Brand />
          <Label style={{ marginTop: 16 }}>
            Getting your schedule in sync…
          </Label>
          <Skeleton />
        </Screen>
      ) : loadError ? (
        <Screen>
          <Brand />
          <Empty
            title="We couldn't load your schedule."
            description="Your saved data has been kept. Please try again."
            action="Try Again"
            onPress={retryLoad}
          />
        </Screen>
      ) : (
        <ReadyApp />
      )}
    </ThemeProvider>
  );
}
function ReadyApp() {
  const theme = useTheme();
  const { saveError, retrySave, sync, dismissSyncMessage, flush } = useApp();
  useNotifications();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <AppNavigator />
      <DialogHost />
      {sync.message && !saveError && (
        <View
          accessibilityLiveRegion="polite"
          style={{ backgroundColor: theme.surface, padding: 16, gap: 8 }}
        >
          <Label size={13}>{sync.message}</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {sync.state === "offline" && (
              <Button small onPress={() => void flush()}>
                Try Again
              </Button>
            )}
            <Button small variant="ghost" onPress={dismissSyncMessage}>
              Dismiss
            </Button>
          </View>
        </View>
      )}
      {saveError && (
        <View
          accessibilityLiveRegion="polite"
          style={{ backgroundColor: theme.surface, padding: 16, gap: 8 }}
        >
          <Label size={13}>
            We couldn't save your latest changes. Keep the app open and try
            again.
          </Label>
          <Button small onPress={retrySave}>
            Try Again
          </Button>
        </View>
      )}
    </View>
  );
}
function FontGate({ onRetry }: { onRetry: () => void }) {
  const [loaded, error] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 650);
    return () => clearTimeout(timer);
  }, []);
  if (error)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 28,
          gap: 20,
          backgroundColor: palette.ivory,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "700", color: palette.navy }}>
          We couldn't load the app fonts.
        </Text>
        <Text style={{ color: palette.navy, fontSize: 16 }}>
          Please try again to open ShiftSync.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={{
            minHeight: 50,
            backgroundColor: palette.teal,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: palette.ink, fontSize: 16, fontWeight: "600" }}>
            Try Again
          </Text>
        </Pressable>
      </View>
    );
  if (!loaded || !splashDone) return <Splash />;
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
export default function App() {
  const [attempt, setAttempt] = useState(0);
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <FontGate
          key={attempt}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
