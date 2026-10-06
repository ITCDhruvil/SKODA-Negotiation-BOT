import type { ContractDoc } from "@/lib/api";

/** The contract as shown and edited on the page: the stored contract plus the letterhead name and logo. */
export type EditableContract = ContractDoc & { company_name: string; logo_url: string };

export const DEFAULT_LOGO = "/skoda-emblem.png";
const COMPANY_NAME = "SKODA Auto Volkswagen India Private Limited";

export function withDefaults(d: ContractDoc): EditableContract {
  return { ...d, company_name: COMPANY_NAME, logo_url: DEFAULT_LOGO };
}

/** Values that follow from the schedule, so a changed quantity or price carries through to the totals. */
export function recalc(d: EditableContract): EditableContract {
  const items = d.items.map((i) => ({ ...i, value: round2(i.qty * i.unit_price) }));
  const total = round2(items.reduce((sum, i) => sum + i.value, 0));
  const saved = round2(d.direction === "buy" ? d.original_value - total : total - d.original_value);
  return { ...d, items, total_value: total, saved };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Edits are kept in this browser, per contract. They apply only while the stored contract is the one they were made on.
const key = (no: string) => `contract-edit:${no}`;

export function loadEdit(base: ContractDoc): EditableContract | null {
  try {
    const raw = localStorage.getItem(key(base.contract_no));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { base_hash: string; doc: EditableContract };
    return saved.base_hash === base.doc_hash ? saved.doc : null;
  } catch {
    return null;
  }
}

export function saveEdit(base: ContractDoc, doc: EditableContract): boolean {
  try {
    localStorage.setItem(key(base.contract_no), JSON.stringify({ base_hash: base.doc_hash, doc }));
    return true;
  } catch {
    return false;
  }
}

export function clearEdit(no: string): void {
  try {
    localStorage.removeItem(key(no));
  } catch {
    /* nothing stored, nothing to clear */
  }
}
