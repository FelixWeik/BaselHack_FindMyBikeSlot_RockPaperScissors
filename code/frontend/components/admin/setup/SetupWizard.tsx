"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { ListSkeleton } from "@/components/ui/primitives";
import { flushAdmin, putParking, useAdmin, type AdminState } from "@/lib/adminStore";
import { applyCalibration, type CalibrationDraft, drawingIssues, overlapWarnings, placeSubZones, planIssues, startDraft, targetParking } from "@/lib/calibration";
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
  const { parkings, devices, save } = admin;
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
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // A photo only lives in this browser tab, as an object URL.
  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo);
  }, [photo]);

  const target = useMemo(() => (draft ? targetParking(draft.target, parkings) : null), [draft, parkings]);
  const placed = useMemo(() => (draft && target ? { ...draft, subZones: placeSubZones(draft.subZones, target) } : null), [draft, target]);

  const drawIssues = draft ? drawingIssues(draft.subZones) : [];
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

  const device = draft && devices.find((d) => d.id === draft.camera.id);
  const home = draft && parkings.some((p) => p.cameras.some((c) => c.id === draft.camera.id));
  const image = photo ?? device?.snapshotUrl ?? null;

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
            setPhoto(null);
            go(2, camera.id);
          }}
        />
      )}
      {step === 2 && draft && (
        <DrawStep
          cameraName={draft.camera.name}
          cameraId={draft.camera.id}
          image={image}
          onPhoto={setPhoto}
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
          parkings={parkings}
          locked={Boolean(home)}
          issues={toReview}
          onTarget={(next) => {
            // Renaming a new zone keeps the plan. Coordinates mean nothing on another plan: the blocks get placed again.
            const samePlan = next.kind === "new" && draft.target.kind === "new";
            setDraft({ ...draft, target: next, subZones: samePlan ? placed.subZones : draft.subZones.map((zone) => ({ ...zone, boundary: [] })) });
          }}
          onChange={(subZones) => setDraft({ ...draft, subZones })}
          onBack={() => go(2)}
          onNext={() => go(4)}
        />
      )}
      {step === 4 && placed && target && (
        <ReviewStep draft={placed} target={target} warnings={overlapWarnings(applyCalibration(target, placed, ""), placed)} submitted={submitted} saving={submitted && save === "saving"} failed={submitted && save === "failed"} onBack={() => go(3)} onSave={() => void finish()} />
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
