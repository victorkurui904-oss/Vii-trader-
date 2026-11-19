"use client";

import { useEffect, useState } from "react";

export default function DerivCallbackPage() {
  const [message, setMessage] = useState("Completing Deriv connection...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, "", window.location.pathname);

    const clearOAuthState = () => {
      sessionStorage.removeItem("deriv_oauth_state");
      sessionStorage.removeItem("deriv_pkce_verifier");
    };

    const error = params.get("error");
    if (error) {
      setMessage(
        params.get("error_description") || "Deriv authorization failed.",
      );
      clearOAuthState();
      return;
    }

    const returnedState = params.get("state");
    const expectedState = sessionStorage.getItem("deriv_oauth_state");
    const codeVerifier = sessionStorage.getItem("deriv_pkce_verifier");
    const code = params.get("code");

    if (!expectedState || returnedState !== expectedState) {
      setMessage("Authorization state mismatch. Please try again.");
      clearOAuthState();
      return;
    }

    if (!code || !codeVerifier) {
      setMessage("Deriv did not return a complete authorization response.");
      clearOAuthState();
      return;
    }

    void fetch("/api/deriv/oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier }),
      cache: "no-store",
    })
      .then(async (response) => {
        let payload: { error?: string } = {};
        try {
          payload = (await response.json()) as { error?: string };
        } catch {
          throw new Error("The server returned an invalid authorization response.");
        }

        if (!response.ok) {
          throw new Error(payload.error || "Could not complete Deriv authorization.");
        }

        clearOAuthState();
        window.location.replace("/");
      })
      .catch((exchangeError: unknown) => {
        clearOAuthState();
        setMessage(
          exchangeError instanceof Error
            ? exchangeError.message
            : "Could not complete Deriv authorization.",
        );
      });
  }, []);

  return (
    <main className="shell">
      <section className="callbackCard">
        <span className="brandMark">B</span>
        <p>{message}</p>
      </section>
    </main>
  );
}
