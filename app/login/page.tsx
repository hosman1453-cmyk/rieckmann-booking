"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;

interface LoginState {
  email: string;
  password: string;
  isLoading: boolean;
  error: string | null;
  isLocked: boolean;
  lockoutTimer: number;
  showPassword: boolean;
}

export default function LoginPage() {
  const router = useRouter();

  const [state, setState] = useState<LoginState>({
    email: "",
    password: "",
    isLoading: false,
    error: null,
    isLocked: false,
    lockoutTimer: 0,
    showPassword: false,
  });

  useEffect(() => {
    if (!state.isLocked || state.lockoutTimer <= 0) return;

    const interval = setInterval(() => {
      setState((prev) => ({
        ...prev,
        lockoutTimer: Math.max(0, prev.lockoutTimer - 1),
        isLocked: prev.lockoutTimer > 1,
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isLocked, state.lockoutTimer]);

  const checkRateLimit = useCallback((identifier: string): boolean => {
    const now = Date.now();
    const attempt = loginAttempts.get(identifier);

    if (!attempt) {
      loginAttempts.set(identifier, { count: 1, lastAttempt: now });
      return true;
    }

    if (attempt.count >= MAX_ATTEMPTS) {
      const timeSinceLastAttempt = now - attempt.lastAttempt;

      if (timeSinceLastAttempt < LOCKOUT_DURATION) {
        const remainingSeconds = Math.ceil(
          (LOCKOUT_DURATION - timeSinceLastAttempt) / 1000
        );

        setState((prev) => ({
          ...prev,
          isLocked: true,
          lockoutTimer: remainingSeconds,
          error: `Zu viele fehlgeschlagene Versuche. Bitte versuchen Sie es in ${remainingSeconds} Sekunden erneut.`,
        }));

        return false;
      }

      loginAttempts.set(identifier, { count: 1, lastAttempt: now });
      return true;
    }

    attempt.count += 1;
    attempt.lastAttempt = now;
    return true;
  }, []);

  const sanitizeInput = useCallback((input: string): string => {
    return input.trim().replace(/[<>]/g, "").slice(0, 254);
  }, []);

  const validateInputs = useCallback(
    (email: string, password: string): string | null => {
      if (!email || !password) {
        return "E-Mail und Passwort sind erforderlich.";
      }

      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

      if (!emailRegex.test(email)) {
        return "Bitte geben Sie eine gültige E-Mail-Adresse ein.";
      }

      if (password.length < 8) {
        return "Das Passwort muss mindestens 8 Zeichen lang sein.";
      }

      if (password.length > 128) {
        return "Das Passwort ist zu lang.";
      }

      return null;
    },
    []
  );

  const handleLogin = useCallback(async () => {
    if (state.isLoading || state.isLocked) return;

    const sanitizedEmail = sanitizeInput(state.email);
    const sanitizedPassword = state.password.trim();

    const validationError = validateInputs(sanitizedEmail, sanitizedPassword);

    if (validationError) {
      setState((prev) => ({ ...prev, error: validationError }));
      return;
    }

    const identifier = `${sanitizedEmail.toLowerCase()}_${
      typeof window !== "undefined" ? window.location.hostname : "server"
    }`;

    if (!checkRateLimit(identifier)) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: sanitizedEmail,
          password: sanitizedPassword,
        });

      if (signInError) {
        const attempt = loginAttempts.get(identifier);

        if (attempt) {
          attempt.count += 1;
          attempt.lastAttempt = Date.now();
        }

        setState((prev) => ({
          ...prev,
          error: "Anmeldedaten sind falsch. Bitte versuchen Sie es erneut.",
          isLoading: false,
        }));

        return;
      }

      if (data.session) {
        loginAttempts.delete(identifier);

        const isSecureContext =
          typeof window !== "undefined" &&
          window.location.protocol === "https:";

        if (!isSecureContext && process.env.NODE_ENV === "production") {
          console.warn("Anmeldung über unsichere Verbindung.");
        }

        const { data: userData, error: userError } =
          await supabase.auth.getUser();

        if (userError || !userData.user) {
          setState((prev) => ({
            ...prev,
            error: "Sitzung konnte nicht bestätigt werden.",
            isLoading: false,
          }));

          await supabase.auth.signOut();
          return;
        }

        router.replace("/admin");
        router.refresh();
        return;
      }

      setState((prev) => ({
        ...prev,
        error: "Sitzung konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
        isLoading: false,
      }));
    } catch (err) {
      console.error("Login error:", err);

      setState((prev) => ({
        ...prev,
        error: "Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.",
        isLoading: false,
      }));
    }
  }, [
    state.email,
    state.password,
    state.isLoading,
    state.isLocked,
    sanitizeInput,
    validateInputs,
    checkRateLimit,
    router,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.repeat) {
        handleLogin();
      }
    },
    [handleLogin]
  );

  const togglePasswordVisibility = useCallback(() => {
    setState((prev) => ({ ...prev, showPassword: !prev.showPassword }));
  }, []);

  const updateField = useCallback(
    (
      field: keyof Omit<
        LoginState,
        "isLoading" | "error" | "isLocked" | "lockoutTimer"
      >
    ) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setState((prev) => ({
          ...prev,
          [field]: e.target.value,
          error: null,
        }));
      },
    []
  );

  return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">Anmelden</h1>

        {state.error && (
          <div className="error-message" role="alert" aria-live="polite">
            {state.error}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="beispiel@firma.de"
            value={state.email}
            onChange={updateField("email")}
            onKeyDown={handleKeyDown}
            disabled={state.isLoading || state.isLocked}
            className="form-input"
            maxLength={254}
            aria-required="true"
            aria-invalid={!!state.error}
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Passwort</label>
          <div className="password-wrapper">
            <input
              id="password"
              type={state.showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={state.password}
              onChange={updateField("password")}
              onKeyDown={handleKeyDown}
              disabled={state.isLoading || state.isLocked}
              className="form-input"
              maxLength={128}
              aria-required="true"
            />
            <button
              type="button"
              className="toggle-password"
              onClick={togglePasswordVisibility}
              disabled={state.isLoading}
              aria-label={
                state.showPassword ? "Passwort ausblenden" : "Passwort anzeigen"
              }
            >
              {state.showPassword ? "Ausblenden" : "Anzeigen"}
            </button>
          </div>
        </div>

        <button
          onClick={handleLogin}
          disabled={state.isLoading || state.isLocked}
          className="login-button"
          aria-busy={state.isLoading}
        >
          {state.isLoading
            ? "Anmeldung läuft..."
            : state.isLocked
            ? `Gesperrt (${state.lockoutTimer}s)`
            : "Anmelden"}
        </button>

        <div className="security-info">
          <small>
            Diese Seite ist durch SSL geschützt. Ihr Passwort wird sicher
            übertragen.
          </small>
        </div>
      </div>

      <style jsx>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            sans-serif;
        }

        .login-card {
          width: 100%;
          max-width: 420px;
          padding: 40px;
          background: #0f3460;
          border-radius: 16px;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .login-title {
          margin: 0 0 28px 0;
          font-size: 28px;
          font-weight: 700;
          color: #eaeaea;
          text-align: center;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 600;
          color: #a0aec0;
        }

        .form-input {
          width: 100%;
          padding: 12px 16px;
          font-size: 16px;
          border: 2px solid #2d3748;
          border-radius: 8px;
          background: #1a202c;
          color: #e2e8f0;
          transition: all 0.2s ease;
          box-sizing: border-box;
        }

        .form-input:focus {
          outline: none;
          border-color: #667eea;
          background: #2d3748;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
        }

        .form-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .password-wrapper {
          position: relative;
        }

        .toggle-password {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          font-size: 13px;
          color: #cbd5e0;
          padding: 4px;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .toggle-password:hover:not(:disabled) {
          opacity: 1;
        }

        .login-button {
          width: 100%;
          padding: 14px;
          margin-top: 8px;
          font-size: 16px;
          font-weight: 600;
          color: white;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .login-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }

        .login-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .login-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          filter: grayscale(0.5);
        }

        .error-message {
          padding: 12px 16px;
          margin-bottom: 20px;
          background: rgba(229, 62, 62, 0.1);
          border: 1px solid rgba(229, 62, 62, 0.3);
          border-radius: 8px;
          color: #fc8181;
          font-size: 14px;
          text-align: center;
          animation: shake 0.5s ease-in-out;
        }

        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-5px);
          }
          75% {
            transform: translateX(5px);
          }
        }

        .security-info {
          margin-top: 20px;
          text-align: center;
          color: #718096;
        }

        .security-info small {
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}