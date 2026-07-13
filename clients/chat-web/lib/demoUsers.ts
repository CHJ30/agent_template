export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export const USERS = {
  alice: {
    name: "Alice",
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMSIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.etoW-VgwcnfEPPOcBTxxTrRSHWfyEaSArrdCyqNGIns",
  },
  bob: {
    name: "Bob",
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyLTAwMiIsImlhdCI6MTc4MTg2NDM5MywiZXhwIjoxODEzNDAwMzkzfQ.81bNean8CFDSh19FbauV-AnkHS0u1ZxHGRbaWuBOaX8",
  },
} as const;

export type UserKey = keyof typeof USERS;

export const USER_KEYS = Object.keys(USERS) as UserKey[];
export const DEFAULT_USER_KEY: UserKey = "alice";

export function isUserKey(value: string | null): value is UserKey {
  return value === "alice" || value === "bob";
}
