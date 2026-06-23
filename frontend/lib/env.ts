export const env = {
  API_BASE_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1",
  WS_BASE_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/api/v1",
};
