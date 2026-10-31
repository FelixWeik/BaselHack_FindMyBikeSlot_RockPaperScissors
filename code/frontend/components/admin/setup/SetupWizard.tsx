"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { ListSkeleton } from "@/components/ui/primitives";
import { flushAdmin, putParking, useAdmin, type AdminState } from "@/lib/adminStore";
import { captureCalibration } from "@/lib/api";
import { applyCalibration, type CalibrationDraft, drawingIssues, forNewTarget, overlapWarnings, placeSubZones, planIssues, startDraft, targetIssues, targetParking } from "@/lib/calibration";
import { AdminUnreachable } from "../AdminUnreachable";
import { CameraStep } from "./CameraStep";
import { DrawStep } from "./DrawStep";
import { PlanStep } from "./PlanStep";
import { ReviewStep } from "./ReviewStep";

const STEPS = ["Camera", "Draw", "Plan", "Review"];

function Stepper({ step, reachable, onGo }: { step: number; reachable: number; onGo: (step: number) => void }) {
  return (
    <ol aria-label="Steps" className="mb-5 grid grid-cols-4 gap-2">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const current = number === step;
        return (
          <li key={label}>
            <button
              type="button"
              disabled={number > reachable}
              aria-current={current ? "step" : undefined}
              onClick={() => onGo(number)}
              className={`tap flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-2 text-sm font-semibold disabled:opacity-40 ${current ? "bg-primary text-primary-fg" : "bg-surface-2"}`}
            >
              <span className="tabular-nums">{number}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Wizard({ admin }: { admin: AdminState }) {
  const { parkings, devices, save, saveError } = admin;
  const params = useSearchParams();
  const router = useRouter();

  const cameraFor = (id: string | null) => {
    const device = devices.find((d) => d.id === id);
    if (device) return { id: device.id, name: device.name };
    const known = parkings.flatMap((p) => p.cameras).find((c) => c.id === id);
    return known ? { id: known.id, name: known.name } : null;
  };

  const [draft, setDraft] = useState<CalibrationDraft | null>(() => {
    const camera = cameraFor(params.get("camera"));
    return camera ? startDraft(camera, parkings) : null;
  });
  const [submitted, setSubmitted] = useState(false);

  // Asks for a fresh capture whenever the camera changes or the admin wants a new one.
  const [attempt, setAttempt] = useState(0);
  const [shot, setShot] = useState<{ key: string; url: string | null; error: string | null } | null>(null);
  const cameraId = draft?.camera.id;
  const shotKey = cameraId ? `${cameraId}:${attempt}` : null;
  useEffect(() => {
    if (!cameraId || !shotKey) return;
    let current = true;
    captureCalibration(cameraId).then(
      (blob) => {
        if (current) setShot({ key: shotKey, url: URL.createObjectURL(blob), error: null });
      },
      (error: unknown) => {
        if (current) setShot({ key: shotKey, url: null, error: error instanceof Error ? error.message : "The capture failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [cameraId, shotKey]);

  // The capture only lives in this browser tab, as an object URL, until a newer one replaces it or the wizard closes.
  const shotUrl = shot?.url;
  useEffect(() => {
    if (!shotUrl) return;
    return () => URL.revokeObjectURL(shotUrl);
  }, [shotUrl]);

  const target = useMemo(() => (draft ? targetParking(draft.target, parkings) : null), [draft, parkings]);
  const placed = useMemo(() => (draft && target ? { ...draft, subZones: placeSubZones(draft.subZones, target) } : null), [draft, target]);

  const drawIssues = draft ? [...targetIssues(draft.target), ...drawingIssues(draft.subZones)] : [];
  const toReview = placed ? planIssues(placed) : [];
  const reachable = !draft ? 1 : drawIssues.length > 0 ? 2 : toReview.length > 0 ? 3 : 4;
  const step = Math.min(Math.max(1, Number(params.get("step")) || 1), reachable);

  // A pushed entry lets the browser's back gesture go back one step instead of leaving the wizard.
  const go = (next: number, cameraId = draft?.camera.id) => {
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(next));
    if (cameraId) url.searchParams.set("camera", cameraId);
    window.history.pushState(null, "", url);
  };

  const home = draft && parkings.some((p) => p.cameras.some((c) => c.id === draft.camera.id));
  const capturing = Boolean(shotKey) && shot?.key !== shotKey;

  const finish = async () => {
    if (!placed || !target) return;
    if (!submitted) {
      putParking(applyCalibration(target, placed, new Date().toISOString()));
      setSubmitted(true);
    }
    if (await flushAdmin()) router.push("/admin");
  };

  return (
    <>
      <Stepper step={step} reachable={submitted ? step : reachable} onGo={go} />

      {step === 1 && (
        <CameraStep
          parkings={parkings}
          devices={devices}
          onPick={(camera) => {
            setDraft(startDraft(camera, parkings));
            go(2, camera.id);
          }}
        />
      )}
      {step === 2 && draft && target && (
        <DrawStep
          cameraName={draft.camera.name}
          cameraId={draft.camera.id}
          image={capturing ? null : (shot?.url ?? null)}
          capturing={capturing}
          captureError={capturing ? null : (shot?.error ?? null)}
          onRecapture={() => setAttempt(attempt + 1)}
          target={target}
          draftTarget={draft.target}
          parkings={parkings}
          locked={Boolean(home)}
          onTarget={(next) => {
            // Renaming a new zone keeps what's drawn on it; another zone has another plan and other sub-zones.
            const samePlan = next.kind === "new" && draft.target.kind === "new";
            setDraft({ ...draft, target: next, subZones: samePlan ? draft.subZones : forNewTarget(draft.subZones, draft.camera.id) });
          }}
          subZones={draft.subZones}
          onChange={(subZones) => setDraft({ ...draft, subZones })}
          issues={drawIssues}
          onBack={() => go(1)}
          onNext={() => go(3)}
        />
      )}
      {step === 3 && draft && placed && target && (
        <PlanStep
          draft={placed}
          target={target}
          issues={toReview}
          onChange={(subZones) => setDraft({ ...draft, subZones })}
          onBack={() => go(2)}
          onNext={() => go(4)}
        />
      )}
      {step === 4 && placed && target && (
        <ReviewStep draft={placed} target={target} warnings={overlapWarnings(applyCalibration(target, placed, ""))} submitted={submitted} saving={submitted && save === "saving"} failed={submitted && save === "failed"} error={saveError} onBack={() => go(3)} onSave={() => void finish()} />
      )}
    </>
  );
}

export function SetupWizard() {
  const admin = useAdmin();
  return (
    <>
      <PageHeader eyebrow="Admin" title="Create a zone" />
      <p className="-mt-3 mb-5">
        <Link href="/admin" className="text-sm font-semibold text-muted underline">
          Cancel and go back to the admin
        </Link>
      </p>
      {admin.status === "error" ? <AdminUnreachable /> : admin.status === "loading" ? <ListSkeleton /> : <Wizard admin={admin} />}
    </>
  );
}
