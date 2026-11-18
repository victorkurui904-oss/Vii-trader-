"use client";

import { useEffect, useState } from "react";

type DerivAccount = {
  loginId: string;
  token: string;
  currency: string;
  isVirtual: boolean;
};

export default function DerivCallbackPage() {
  const [message, setMessage] = useState("Completing Deriv connection...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, "", window.location.pathname);
    const error = params.get("error");
    if (error) {
      setMessage(params.get("error_description") || "Deriv authorization failed.");
      sessionStorage.removeItem("deriv_oauth_state");
      return;
    }

    const returnedState = params.get("state");
    const expectedState = sessionStorage.getItem("deriv_oauth_state");

    if (!expectedState || returnedState !== expectedState) {
      setMessage("Authorization state mismatch. Please try again.");
      sessionStorage.removeItem("deriv_oauth_state");
      return;
    }

    sessionStorage.removeItem("deriv_oauth_state");

    const accounts: DerivAccount[] = [];

    for (let index = 1; index <= 20; index += 1) {
      const loginId = params.get(`acct${index}`);
      const token = params.get(`token${index}`);
      const currency = params.get(`cur${index}`) ?? "";

      if (loginId && token) {
        accounts.push({
          loginId,
          token,
          currency,
          isVirtual: loginId.startsWith("VRTC"),
        });
      }
    }

    if (accounts.length === 0) {
      setMessage("No Deriv account was returned. Please try again.");
      return;
    }

    sessionStorage.setItem("deriv_accounts", JSON.stringify(accounts));
    window.location.replace("/");
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
