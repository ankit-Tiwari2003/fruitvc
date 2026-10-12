/**
 * roomsApi — the one place in the app that knows the Worker's HTTP shape.
 * Every component/hook calls through here instead of using fetch directly,
 * so the endpoint URLs and response shapes only need to be correct in one
 * place.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL as string;

export function getApiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not set — check your .env file");
  }
  return API_BASE_URL;
}

export function getWsBaseUrl(): string {
  if (!WS_BASE_URL) {
    throw new Error("VITE_WS_BASE_URL is not set — check your .env file");
  }
  return WS_BASE_URL;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(`API error ${status}: ${code}`);
  }
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? "unknown_error");
  }
  return data as T;
}

export interface CreateRoomResponse {
  roomId: string;
}

export async function createRoom(): Promise<CreateRoomResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/rooms`, { method: "POST" });
  return handleJson<CreateRoomResponse>(res);
}

export interface RoomInfoResponse {
  exists: boolean;
  participantCount: number;
  createdAt: number | null;
}

export async function getRoomInfo(roomId: string): Promise<RoomInfoResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/rooms/${roomId}`);
  return handleJson<RoomInfoResponse>(res);
}

export interface JoinRoomResponse {
  participantId: string;
  name: string;
  token: string;
}

export async function joinRoom(roomId: string, name?: string): Promise<JoinRoomResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
  return handleJson<JoinRoomResponse>(res);
}
