"use client";

import { useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  installEvent: InstallPromptEvent | null;
  waitingWorker: ServiceWorker | null;
  registration: ServiceWorkerRegistration | null;
  installed: boolean;
}

const SERVER: PwaState = { installEvent: null, waitingWorker: null, registration: null, installed: false };

let state = SERVER;
const listeners = new Set<() => void>();
let started = false;
let updateAccepted = false;

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function trackWaiting(reg: ServiceWorkerRegistration) {
  // No controller means this is the first install, not an update.
  if (reg.waiting && navigator.serviceWorker.controller) set({ waitingWorker: reg.waiting });
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) set({ waitingWorker: worker });
    });
  });
}

const workerUrl = (build: string | undefined) => `/sw.js?v=${build}`;

/** The build id is baked into the running bundle, so a tab left open has to ask the server for the current one. */
async function checkForUpdate() {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    const { build } = (await res.json()) as { build?: string };
    if (build && build !== process.env.NEXT_PUBLIC_BUILD_ID) await navigator.serviceWorker.register(workerUrl(build));
  } catch {
    // offline: check again next time the app comes back to the foreground
  }
}

function start() {
  if (started) return;
  started = true;

  set({ installed: window.matchMedia("(display-mode: standalone)").matches });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    set({ installEvent: e as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => set({ installed: true, installEvent: null }));

  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  // Only after the user accepted: the first install also changes the controller, and must not reload the page.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateAccepted) window.location.reload();
  });
  navigator.serviceWorker
    .register(workerUrl(process.env.NEXT_PUBLIC_BUILD_ID))
    .then((registration) => {
      set({ registration });
      trackWaiting(registration);
    })
    .catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePwa() {
  const pwa = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
  return {
    ...pwa,
    canPrompt: !!pwa.installEvent,
    async install() {
      if (!pwa.installEvent) return;
      await pwa.installEvent.prompt();
      await pwa.installEvent.userChoice;
      set({ installEvent: null });
    },
    applyUpdate() {
      updateAccepted = true;
      pwa.waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    },
  };
}

const subscribeNever = () => () => {};

export function useIsIos(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone,
    () => false,
  );
}
