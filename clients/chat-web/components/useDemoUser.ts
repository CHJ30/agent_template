"use client";

import { useEffect, useState } from "react";
import { DEFAULT_USER_KEY, isUserKey, type UserKey } from "../lib/demoUsers";

const STORAGE_KEY = "autix-demo-user";

export function useDemoUser() {
  const [userKey, setUserKeyState] = useState<UserKey>(DEFAULT_USER_KEY);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isUserKey(stored)) setUserKeyState(stored);
  }, []);

  function setUserKey(next: UserKey) {
    setUserKeyState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return [userKey, setUserKey] as const;
}
