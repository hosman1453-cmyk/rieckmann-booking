export type Insurance =
  | "gesetzlich"
  | "privat"
  | "selbstzahler"
  | "hausbesuch_peterhausen"
  | "hausbesuch_allensbach"
  | "hausbesuch_reichenau";

export interface ServiceItem {
  title: string;
  subtitle: string;
  duration: string;
  price?: string;
}

export interface Therapist {
  id: number;
  name?: string;
  active?: boolean | null;
}

export interface TherapistHours {
  therapist_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_working: boolean;
}

export interface Verfuegbar {
  therapist_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

export interface HausbesuchSetting {
  therapist_id: number;
  region: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface BlockedRange {
  therapist_id: number;
  date: string;
  start_time: string;
  end_time: string;
}

export interface BookedEntry {
  therapist_id: number | null;
  date?: string;
  time: string;
}

type TimeRange = { start: number; end: number };

export const VALID_INSURANCE: Insurance[] = [
  "gesetzlich",
  "privat",
  "selbstzahler",
  "hausbesuch_peterhausen",
  "hausbesuch_allensbach",
  "hausbesuch_reichenau",
];

export const gesetzlicheServices: ServiceItem[] = [
  { title: "Krankengymnastik/Manuelle Therapie Doppeltermin", subtitle: "(KG oder MT Doppeltermin auf Rezept)", duration: "40 Min." },
  { title: "Krankengymnastik/Manuelle Therapie", subtitle: "(KG/MT auf Rezept)", duration: "20 Min." },
  { title: "KG-ZNS PNF", subtitle: "(Krankengymnastik mit PNF)", duration: "40 Min." },
  { title: "KG-Atemtherapie + KMT", subtitle: "(KG-AT + Klassische Massagetherapie)", duration: "40 Min." },
  { title: "KG-ZNS Erwachsene Bobath", subtitle: "(Krankengymnastik für Erwachsene)", duration: "40 Min." },
  { title: "Krankengymnastik Doppel PLUS", subtitle: "(KG einfach + privater Anteil)", duration: "40 Min.", price: "40,00 €" },
  { title: "Manuelle Lymphdrainage 60", subtitle: "(MLD 60 auf Rezept)", duration: "1 Std." },
  { title: "Manuelle Lymphdrainage 45", subtitle: "(MLD 45 auf Rezept)", duration: "40 Min." },
  { title: "Manuelle Lymphdrainage 30", subtitle: "(MLD 30 auf Rezept)", duration: "20 Min." },
  { title: "KMT auf Rezept", subtitle: "(Klassische Massagetherapie)", duration: "20 Min." },
];

export const selbstzahlerServices: ServiceItem[] = [
  { title: "Fußreflexzonen Massage", subtitle: "Fußmassage auf Basis der Fußreflexzonen", duration: "40 Min.", price: "55,00 €" },
];

export const privateServices: ServiceItem[] = [
  { title: "Krankengymnastik P", subtitle: "(KG auf Rezept Privat)", duration: "20 Min." },
  { title: "Manuelle Therapie P", subtitle: "(MT auf Rezept Privat)", duration: "20 Min." },
  { title: "Krankengymnastik/Manuelle Therapie Doppeltermin P", subtitle: "(KG/MT Doppeltermin Privat)", duration: "40 Min." },
  { title: "KG-ZNS PNF P", subtitle: "(Krankengymnastik mit PNF)", duration: "40 Min." },
  { title: "KG-ZNS Erwachsene Bobath P", subtitle: "(Bobath Konzept)", duration: "40 Min." },
  { title: "KG ATG + KMT P", subtitle: "(Atemtherapie + Massage)", duration: "40 Min." },
  { title: "Manuelle Lymphdrainage 45 P", subtitle: "(MLD 45 Privat)", duration: "40 Min." },
  { title: "Manuelle Lymphdrainage 60 P", subtitle: "(MLD 60 Privat)", duration: "1 Std." },
  { title: "Manuelle Lymphdrainage 30 P", subtitle: "(MLD 30 privat)", duration: "40 Min." },
  { title: "Klassische Massagetherapie P", subtitle: "(KMT Privat)", duration: "20 Min." },
];

export const hausbesuchServices: ServiceItem[] = [
  ...gesetzlicheServices,
  ...selbstzahlerServices,
  ...privateServices,
].filter((service) => {
  const duration = parseDuration(service.duration);
  return duration === 40 || duration === 60;
});

export const ALL_VALID_SERVICES: ServiceItem[] = [
  ...gesetzlicheServices,
  ...selbstzahlerServices,
  ...privateServices,
  ...hausbesuchServices,
];

export function sanitizeText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

export function sanitizeEmail(input: string): string {
  const email = input.trim();
  const pattern = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(email) ? email : "";
}

export function sanitizePhone(input: string): string {
  return input.replace(/[^0-9+\-() ]/g, "").trim().slice(0, 30);
}

export function validateName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 100 && !/<|>|script/i.test(trimmed);
}

export function parseDuration(duration: string): number {
  if (duration.includes("Std")) return 60;
  const match = duration.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 20;
}

export function getRequiredSlots(duration: string, isHausbesuch: boolean): number {
  return isHausbesuch ? 1 : Math.ceil(parseDuration(duration) / 20);
}

export function insuranceToHbRegion(insurance: string): string | null {
  if (insurance === "hausbesuch_peterhausen") return "peterhausen";
  if (insurance === "hausbesuch_allensbach") return "allensbach";
  if (insurance === "hausbesuch_reichenau") return "reichenau";
  return null;
}

export function getBaseSlots(): string[] {
  const slots: string[] = [];
  for (let hour = 7; hour < 21; hour += 1) {
    for (let minute = 0; minute < 60; minute += 20) {
      const start = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const endHour = minute + 20 >= 60 ? hour + 1 : hour;
      const endMinute = (minute + 20) % 60;
      slots.push(`${start} - ${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`);
    }
  }
  return slots;
}

export function getHausbesuchSlots(): string[] {
  const slots: string[] = [];
  for (let hour = 7; hour < 21; hour += 1) {
    slots.push(`${String(hour).padStart(2, "0")}:00 - ${String(hour + 1).padStart(2, "0")}:00`);
  }
  return slots;
}

export function getSlotIndex(slot: string, isHausbesuch: boolean): number {
  const start = slot.split(" - ")[0];
  return (isHausbesuch ? getHausbesuchSlots() : getBaseSlots()).findIndex((candidate) => candidate.startsWith(start));
}

export function timeToMinutes(time: string): number {
  const match = String(time).match(/^(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

export function parseTimeRange(timeStr: string): TimeRange | null {
  const parts = String(timeStr).split(" - ").map((part) => part.trim());
  if (parts.length < 2) return null;
  const start = timeToMinutes(parts[0]);
  const end = timeToMinutes(parts[1]);
  if (end <= start) return null;
  return { start, end };
}

export function getSlotTimeRange(slot: string, requiredSlots: number, isHausbesuch: boolean): TimeRange | null {
  const slots = isHausbesuch ? getHausbesuchSlots() : getBaseSlots();
  const index = getSlotIndex(slot, isHausbesuch);
  if (index === -1 || index + requiredSlots > slots.length) return null;
  return {
    start: timeToMinutes(slots[index].split(" - ")[0]),
    end: timeToMinutes(slots[index + requiredSlots - 1].split(" - ")[1]),
  };
}

export function getDisplaySlot(slot: string, requiredSlots: number, isHausbesuch: boolean): string {
  const slots = isHausbesuch ? getHausbesuchSlots() : getBaseSlots();
  const index = getSlotIndex(slot, isHausbesuch);
  const end = slots[index + requiredSlots - 1];
  return `${slot.split(" - ")[0]} - ${end ? end.split(" - ")[1] : slot.split(" - ")[1]}`;
}

export function timeRangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function sameTherapist(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

export function hasTimeConflict(
  therapistId: number,
  date: string,
  timeStr: string,
  booked: BookedEntry[],
): boolean {
  const needed = parseTimeRange(timeStr);
  if (!needed) return true;
  return booked.some((booking) => {
    if (!sameTherapist(booking.therapist_id, therapistId)) return false;
    if (booking.date && booking.date !== date) return false;
    const existing = parseTimeRange(booking.time);
    if (!existing) return false;
    return timeRangesOverlap(needed, existing);
  });
}

export function isSlotBlocked(
  slot: string,
  requiredSlots: number,
  therapistId: number,
  date: string,
  blocks: BlockedRange[],
  isHausbesuch: boolean,
): boolean {
  if (!date) return false;
  const slots = isHausbesuch ? getHausbesuchSlots() : getBaseSlots();
  const index = getSlotIndex(slot, isHausbesuch);
  if (index === -1) return false;
  const needed = slots.slice(index, index + requiredSlots);
  return blocks.some((block) => {
    if (block.therapist_id !== therapistId || block.date !== date) return false;
    const blockStart = timeToMinutes(block.start_time);
    const blockEnd = timeToMinutes(block.end_time);
    return needed.some((neededSlot) => {
      const neededStart = timeToMinutes(neededSlot.split(" - ")[0]);
      const neededEnd = timeToMinutes(neededSlot.split(" - ")[1]);
      return neededStart < blockEnd && neededEnd > blockStart;
    });
  });
}

export function isSlotInWorkingHours(
  slot: string,
  requiredSlots: number,
  therapistId: number,
  date: string,
  verfuegbar: Verfuegbar[],
  hours: TherapistHours[],
  isHausbesuch: boolean,
  hausbesuchSettings: HausbesuchSetting[],
  hausbesuchRegion: string | null,
): boolean {
  if (!date) return true;
  const slots = isHausbesuch ? getHausbesuchSlots() : getBaseSlots();
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const index = getSlotIndex(slot, isHausbesuch);
  if (index === -1 || index + requiredSlots > slots.length) return false;
  const slotStart = timeToMinutes(slots[index].split(" - ")[0]);
  const slotEnd = timeToMinutes(slots[index + requiredSlots - 1].split(" - ")[1]);

  if (isHausbesuch && hausbesuchRegion) {
    const hausbesuchRows = hausbesuchSettings.filter(
      (setting) =>
        setting.therapist_id === therapistId &&
        setting.region === hausbesuchRegion &&
        setting.day_of_week === dayOfWeek &&
        setting.is_active,
    );
    if (hausbesuchRows.length === 0) return false;
    return hausbesuchRows.some(
      (setting) => slotStart >= timeToMinutes(setting.start_time) && slotEnd <= timeToMinutes(setting.end_time),
    );
  }

  const availableRows = verfuegbar.filter(
    (row) => row.therapist_id === therapistId && row.day_of_week === dayOfWeek && row.is_available,
  );
  if (availableRows.length > 0) {
    return availableRows.some(
      (row) => slotStart >= timeToMinutes(row.start_time) && slotEnd <= timeToMinutes(row.end_time),
    );
  }

  const therapistHours = hours.find((row) => row.therapist_id === therapistId && row.day_of_week === dayOfWeek);
  if (!therapistHours || !therapistHours.is_working) return false;
  return slotStart >= timeToMinutes(therapistHours.start_time) && slotEnd <= timeToMinutes(therapistHours.end_time);
}

export function isAllowedDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const parsedDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  if (parsedDate !== value) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return value >= todayStr;
}
