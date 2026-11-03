"use client";

import { useLogin, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { useEffect, useEffectEvent } from "react";

const SIGNUP_PARAM = "signup";

/**
 * numofx.com/signup and /login hand off here with `?signup=email`, `wallet` or `google`, since an account's session
 * lives on this domain. Opens that sign-in once, for a visitor not signed in, and drops the param so a reload does not
 * reopen it.
 * Google falls back to the sign-in modal when it cannot start.
 */
export function useSignupHandoff() {
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin();
  const { initOAuth } = useLoginWithOAuth();

  const start = useEffectEvent(async (method: string | null) => {
    if (method === "email" || method === "wallet") {
      login({ loginMethods: [method] });
    } else if (method === "google") {
      try {
        await initOAuth({ provider: "google" });
      } catch {
        login();
      }
    }
  });

  useEffect(() => {
    if (!ready) {
      return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SIGNUP_PARAM)) {
      return;
    }
    const method = url.searchParams.get(SIGNUP_PARAM);
    url.searchParams.delete(SIGNUP_PARAM);
    window.history.replaceState(window.history.state, "", url);
    if (!authenticated) {
      void start(method);
    }
  }, [authenticated, ready]);
}
