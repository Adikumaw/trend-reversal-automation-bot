import { AppData, UserSettings } from "../types";

const API_BASE_URL = "http://75.101.175.60:8000";

export const fetchUiData = async (): Promise<AppData | null> => {
  // Use AbortController to enforce a strict timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout

  try {
    // Add timestamp to query to prevent browser caching (cache busting)
    const response = await fetch(
      `${API_BASE_URL}/api/ui-data?t=${Date.now()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
        cache: "no-store",
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data: AppData = await response.json();
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Failed to fetch UI data:", error);
    return null;
  }
};

export const controlSystem = async (payload: {
  buy_switch?: boolean;
  sell_switch?: boolean;
  cyclic?: boolean;
  emergency_close?: boolean;
}): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (error) {
    console.error("Control request failed:", error);
    return false;
  }
};

export const updateSettings = async (
  settings: UserSettings
): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/update-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return response.ok;
  } catch (error) {
    console.error("Settings update failed:", error);
    return false;
  }
};
