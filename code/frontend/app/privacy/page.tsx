import { PageHeader } from "@/components/shell/PageHeader";
import { ShieldIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";

export const metadata = { title: "Privacy" };

const STEPS = [
  { title: "Camera", text: "Takes a low-resolution photo of the parking every few seconds." },
  { title: "Vision computer", text: "Receives the photos over the local network and works out which areas are free." },
  { title: "Probability map", text: "Only numbers come out: for each square of the parking, the chance of a free spot." },
  { title: "This app", text: "Shows you that map. It never receives a photo." },
];

const PROMISES = [
  "The app never shows you a camera image, and its servers never receive one.",
  "Only an admin calibrating a camera sees a view of the parking. A photo they pick stays in their browser and is not uploaded.",
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
