import React, { useState } from "react";
import { Alert, View } from "react-native";
import {
  Badge,
  Brand,
  Buddy,
  Button,
  Card,
  Choice,
  Field,
  Header,
  Icon,
  Label,
  Screen,
} from "../components/ui";
import { useApp } from "../store/AppStore";
import { useRootNavigation, type StackProps } from "../navigation/types";
import { palette, useTheme } from "../theme";

function CalendarIllustration() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 255,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 16,
      }}
    >
      <View
        style={{
          position: "absolute",
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: theme.soft,
        }}
      />
      <View
        style={{
          width: 204,
          padding: 18,
          borderRadius: 22,
          backgroundColor: theme.surface,
          borderWidth: 2,
          borderColor: palette.beige,
          transform: [{ rotate: "-8deg" }],
          shadowColor: palette.navy,
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <Label weight="semibold">A day for you</Label>
          <Icon name="sparkles-outline" size={18} color={palette.teal} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
          {Array.from({ length: 21 }, (_, n) => (
            <View
              key={n}
              style={{
                width: 16,
                height: 16,
                borderRadius: 5,
                backgroundColor:
                  n === 10
                    ? palette.teal
                    : n === 15
                      ? palette.gold
                      : n === 8
                        ? palette.aqua
                        : theme.soft,
              }}
            />
          ))}
        </View>
        <View
          style={{
            height: 10,
            width: "70%",
            backgroundColor: palette.aqua,
            marginTop: 20,
            borderRadius: 4,
          }}
        />
        <View
          style={{
            height: 10,
            width: "45%",
            backgroundColor: palette.beige,
            marginTop: 9,
            borderRadius: 4,
          }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          right: 10,
          bottom: 22,
          transform: [{ rotate: "12deg" }],
        }}
      >
        <Buddy size={84} />
      </View>
    </View>
  );
}
export function WelcomeScreen({ navigation }: StackProps<"Welcome">) {
  const { setProfile, finishOnboarding } = useApp();
  return (
    <Screen
      footer={
        <View style={{ gap: 10 }}>
          <Button onPress={() => navigation.navigate("SignUp")}>
            Get Started
          </Button>
          <Button
            variant="secondary"
            onPress={() => navigation.navigate("Login")}
          >
            Log In
          </Button>
          <Button
            variant="ghost"
            onPress={() => {
              setProfile({
                name: "Alex Rivera",
                email: "alex@example.com",
                organization: "",
                role: "Employee",
              });
              finishOnboarding();
            }}
          >
            Explore the demo
          </Button>
        </View>
      }
    >
      <Brand />
      <CalendarIllustration />
      <View style={{ marginTop: 26 }}>
        <Badge>More clarity. Less chaos.</Badge>
        <Label
          size={32}
          weight="bold"
          style={{ marginTop: 16, lineHeight: 43 }}
        >
          Your schedule,{`\n`}perfectly in sync.
        </Label>
        <Label tone="muted" size={15} style={{ marginTop: 16 }}>
          Organize your shifts, events, tasks, and availability — with a little
          help from CalenBud.
        </Label>
        <Label size={12} tone="muted" style={{ marginTop: 22 }}>
          This demo saves your schedule on this device.
        </Label>
      </View>
    </Screen>
  );
}
function AuthForm({ signup }: { signup: boolean }) {
  const navigation = useRootNavigation();
  const { setProfile } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    if (signup && !name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (signup && password !== confirm) {
      setError("Your passwords do not match.");
      return;
    }
    if (signup && !agreed) {
      setError("Please acknowledge the demo terms and privacy notice.");
      return;
    }
    const fallbackName = email.trim().split("@")[0].replace(/[._-]/g, " ");
    setProfile({
      name: signup
        ? name.trim()
        : fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1),
      email: email.trim().toLowerCase(),
      organization: organization.trim(),
      role: "Employee",
    });
    setPassword("");
    setConfirm("");
  };
  const provider = (name: string) =>
    Alert.alert(
      `${name} sign-in`,
      `This local demo is not connected to ${name}. Use the demo form or Explore the demo. A production sign-in needs a configured authentication service.`,
    );
  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          {error ? (
            <Label size={13} style={{ color: "#A34738" }}>
              {error}
            </Label>
          ) : null}
          <Button onPress={submit}>
            {signup ? "Create Account" : "Log In"}
          </Button>
        </View>
      }
    >
      <Header title="ShiftSync" back={navigation.goBack} />
      <Label size={27} weight="bold">
        {signup ? "Create your account" : "Welcome back"}
      </Label>
      <Label tone="muted" style={{ marginTop: 8, marginBottom: 22 }}>
        {signup
          ? "A calmer schedule starts here."
          : "Let's get your schedule back in sync."}
      </Label>
      <Card style={{ backgroundColor: "#DFF1EA" }}>
        <Label size={12} style={{ color: palette.navy }}>
          Local demo: this form creates a profile on your device. It does not
          authenticate or create an online account. Passwords are never saved.
        </Label>
      </Card>
      {signup && (
        <Field
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="Your full name"
          autoComplete="name"
          textContentType="name"
        />
      )}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry={!show}
        autoComplete={signup ? "new-password" : "current-password"}
        textContentType={signup ? "newPassword" : "password"}
      />
      <View style={{ alignItems: "flex-end", marginTop: -10, marginBottom: 8 }}>
        <Button
          small
          variant="ghost"
          icon={show ? "eye-off-outline" : "eye-outline"}
          onPress={() => setShow((value) => !value)}
        >
          {show ? "Hide password" : "Show password"}
        </Button>
      </View>
      {signup ? (
        <>
          <Field
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter your password"
            secureTextEntry={!show}
            autoComplete="new-password"
          />
          <Field
            label="Work / organization (optional)"
            value={organization}
            onChangeText={setOrganization}
            placeholder="Your workplace or school"
          />
          <Choice
            label="I agree to the Terms and Privacy Policy."
            selected={agreed}
            onPress={() => setAgreed((value) => !value)}
          />
          <Button
            variant="ghost"
            onPress={() =>
              Alert.alert(
                "Demo terms and privacy",
                "ShiftSync is a local demonstration, without an online account or connected services. Your name, email, and schedule are stored on this device. Do not enter sensitive information. Production terms and a privacy policy must be supplied before public launch.",
              )
            }
          >
            Read demo terms and privacy
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          onPress={() =>
            Alert.alert(
              "Password reset",
              "No password is stored in this local demo. An online password reset requires a configured authentication service. You can enter the demo using any valid email and an eight-character example password.",
            )
          }
        >
          Forgot password?
        </Button>
      )}
      <View style={{ gap: 10, marginTop: 16 }}>
        <Button
          icon="logo-google"
          variant="secondary"
          onPress={() => provider("Google")}
        >
          Continue with Google
        </Button>
        <Button
          icon="logo-microsoft"
          variant="secondary"
          onPress={() => provider("Microsoft")}
        >
          Continue with Microsoft
        </Button>
        <Label
          size={13}
          tone="muted"
          style={{ textAlign: "center", marginTop: 12 }}
        >
          {signup ? "Already have an account?" : "Don't have an account?"}
        </Label>
        <Button
          variant="ghost"
          onPress={() => navigation.replace(signup ? "Login" : "SignUp")}
        >
          {signup ? "Log In" : "Sign Up"}
        </Button>
      </View>
    </Screen>
  );
}
export function LoginScreen() {
  return <AuthForm signup={false} />;
}
export function SignUpScreen() {
  return <AuthForm signup />;
}
