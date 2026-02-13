const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} est requis.`);
  }
  return value;
};

export const getJwtSecret = (): string => {
  const jwtSecret = requireEnv("JWT_SECRET");
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET doit contenir au moins 32 caractères.");
  }
  return jwtSecret;
};

export const getSessionStoreSecret = (): string => {
  const sessionSecret = process.env.SESSION_STORE_SECRET?.trim();
  if (sessionSecret && sessionSecret.length >= 32) {
    return sessionSecret;
  }

  return getJwtSecret();
};

export const getAllowedCorsOrigins = (): string[] => {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return [
      "http://localhost:8081",
      "http://localhost:19006",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:8081",
      "http://127.0.0.1:19006",
    ];
  }

  return [];
};
