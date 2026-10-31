import { PageHeader } from "@/components/shell/PageHeader";
import { ShieldIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";

export const metadata = { title: "Privacy" };

const STEPS = [
  { title: "Camera", text: "Takes a photo of the parking every second and sends it over the local network. It stores nothing." },
  { title: "Vision computer", text: "Looks for bikes in the photo, in memory, then forgets it. No photo is written to disk." },
  { title: "Backend", text: "Only receives the position of each bike in the image, and works out how full each zone is. It keeps no history of them." },
  { title: "This app", text: "Shows you how full each zone is estimated to be. It never receives a photo." },
];

const PROMISES = [
  "The app never shows you a camera image, and no photo is kept anywhere.",
  "Nobody is recognized or followed: the system only looks for bikes.",
  "An admin calibrating a camera gets one fresh view of the parking. Faces are masked first, and if that fails the view isn't sent at all. It only lives in their browser tab until they're done.",
  "Face masking is automatic and can miss a face, for example one that is small or turned away. It reduces the risk, it doesn't remove it.",
  "No account: the app doesn't know who you are.",
  "No analytics or tracking in the app. Your favorites and settings stay on your device.",
];

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Privacy" title="From the camera to your screen" />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <ol aria-label="Data flow" className="flex flex-col">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary font-display font-bold text-primary-fg">
                  {i + 1}
                </span>
                {i < STEPS.length - 1 && <span aria-hidden="true" className="my-1 w-0.5 flex-1 bg-border" />}
              </div>
              <div className="pb-6 pt-1.5">
                <p className="font-display text-lg font-semibold leading-tight">{s.title}</p>
                <p className="mt-1 text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <section aria-labelledby="commitments" className="flex flex-col gap-3">
          <SectionTitle id="commitments">What the app promises</SectionTitle>
          <Card className="divide-y divide-border">
            {PROMISES.map((p) => (
              <p key={p} className="flex gap-3 p-4">
                <span className="shrink-0 text-muted">
                  <ShieldIcon size={22} />
                </span>
                {p}
              </p>
            ))}
          </Card>
        </section>
      </div>
    </>
  );
}
