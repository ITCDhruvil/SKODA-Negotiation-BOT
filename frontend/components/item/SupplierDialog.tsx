"use client";

import { Select } from "@/components/ui/Select";
import { useMemo, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui/basics";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/State";
import type { Direction, Invitee } from "@/lib/api";
import { partyLabel, quoteLabel } from "@/lib/labels";

// Demo only: the supplier invite, consent and one-time code are simulated here. Nothing is sent anywhere.
const DEMO_OTP = "123456";
const CHANNELS = ["Email", "SMS", "WhatsApp"] as const;

/** Mon-Sat, 09:00-20:00 Indian Standard Time. */
function insideContactHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return day !== "Sun" && hour >= 9 && hour < 20;
}

const INVITE: Record<string, (vendor: string, what: string) => string> = {
  en: (v, what) => `Hello ${v}, SAVWIPL invites you to share your ${what} for the open requirement. Please reply to confirm you are happy to proceed.`,
  hi: (v, what) => `नमस्ते ${v}, SAVWIPL आपको खुली आवश्यकता के लिए अपना ${what} साझा करने के लिए आमंत्रित करता है। कृपया आगे बढ़ने की पुष्टि करें।`,
  mr: (v, what) => `नमस्कार ${v}, SAVWIPL तुम्हाला खुल्या मागणीसाठी तुमचा ${what} सामायिक करण्यासाठी आमंत्रित करते. कृपया पुढे जाण्याची पुष्टी करा.`,
};

export function SupplierDialog({
  vendor,
  direction,
  onClose,
  onConfirmed,
}: {
  vendor: Invitee | null;
  direction: Direction;
  onClose: () => void;
  onConfirmed: (vendorId: string) => Promise<void>;
}) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("WhatsApp");
  const [override, setOverride] = useState(false);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"invite" | "reply">("invite");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = vendor != null;
  const inside = useMemo(() => insideContactHours(new Date()), [open]);
  const allowed = inside || override;
  const what = quoteLabel(direction).toLowerCase();

  const close = () => {
    setStep("invite");
    setConsent(false);
    setCode("");
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!vendor) return;
    if (code.trim() !== DEMO_OTP) {
      setError("That code does not match. In this demo the code is shown on screen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirmed(vendor.vendor_id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lang = vendor?.language ?? "en";
  const body = (INVITE[lang] ?? INVITE.en)(vendor?.vendor_name ?? "", what);

  return (
    <Dialog
      open={open}
      title={`${partyLabel(direction)} response (demo)`}
      onClose={close}
      footer={
        step === "invite" ? (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!allowed} onClick={() => setStep("reply")}>
              Send invite
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep("invite")}>Back</Button>
            <Button variant="primary" disabled={!consent || code.trim() === "" || busy} onClick={confirm}>
              {busy ? "Collecting…" : `Receive ${what}`}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4 text-sm">
        <Notice tone="info">Simulation only. No message, consent record or one-time code leaves this screen.</Notice>
        {step === "invite" ? (
          <>
            <Field label="Channel">
              <Select
                value={channel}
                onChange={setChannel}
                ariaLabel="Channel"
                options={CHANNELS.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <div>
              <p className="mb-1 font-semibold text-ink">Message preview ({lang.toUpperCase()}, {channel})</p>
              <p className="rounded-m bg-raise p-3 text-text">{body}</p>
            </div>
            {!inside && (
              <Notice tone="amber">
                Outside contact hours (Mon to Sat, 9:00 to 20:00 IST). Invites are held until the next window.
                <label className="mt-2 flex items-center gap-2 font-semibold">
                  <input type="checkbox" className="h-4 w-4" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Demo override: send now
                </label>
              </Notice>
            )}
          </>
        ) : (
          <>
            <p className="text-text">
              Pretend you are <span className="font-semibold text-ink">{vendor?.vendor_name}</span>: give consent and enter the one-time code to submit the {what}.
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I agree to take part in this negotiation on behalf of my company.</span>
            </label>
            <Field label="One-time code" hint={`Demo code: ${DEMO_OTP}`}>
              <input className={`${inputClass} min-h-[44px]`} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </>
        )}
        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </Dialog>
  );
}
